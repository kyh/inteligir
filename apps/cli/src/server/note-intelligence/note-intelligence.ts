// Note Intelligence (#590): background frontmatter inference over the vault's
// notes. The sweep CONVERGES BY CONSTRUCTION: it only ever ADDS fields a note
// lacks, so its own writes disqualify their notes from the next pass, and a
// files-changed echo re-scans to a zero-update sweep rather than looping.
// A user-set field is never rewritten — the absent-only discipline is
// enforced twice, here (candidate selection) and in the frontmatter helper
// (key-presence check), because the failure mode is silently rewriting what a
// person typed.

import {
  addAbsentFrontmatterFields,
  splitFrontmatter,
  type AbsentFrontmatterField,
  type SplitDoc,
} from "@repo/notes/markdown/frontmatter";
import type {
  NoteIntelligenceStatus,
  NoteIntelligenceSweep,
} from "@repo/api/local/note-intelligence/note-intelligence-schema";

import { headCapUtf8 } from "../agents/agent-instructions";
import type { VaultService } from "../vault/vault-service";
import type { InferenceRunner, InferredFields } from "./infer";
import type { NoteIntelligenceSettingsStore } from "./settings-store";

/** Body bytes handed to inference — a classification needs the head, not the
 *  whole archive. */
const BODY_CAP_BYTES = 12_000;
/** Notes examined per sweep; the rest wait for the next one. */
const SWEEP_BATCH = 8;
/** Concurrent inference children. */
const SWEEP_CONCURRENCY = 3;
/** Quiet period after a files-changed signal before a sweep runs. */
const SWEEP_DEBOUNCE_MS = 30_000;

const INFERABLE_KEYS = ["description", "tags", "status"] as const;

export interface NoteIntelligenceDeps {
  vault: VaultService;
  settings: NoteIntelligenceSettingsStore;
  infer: InferenceRunner;
  /** Test seam: the debounce delay. */
  debounceMs?: number;
  onLog?: (message: string) => void;
}

export interface NoteIntelligence {
  status(): NoteIntelligenceStatus;
  setEnabled(enabled: boolean): NoteIntelligenceStatus;
  /** A files-changed signal; schedules a debounced sweep when enabled. */
  noteVaultChange(): void;
  /** Run one sweep now (the toggle-on kick and the tests' direct door). */
  sweepNow(): Promise<NoteIntelligenceSweep>;
  dispose(): void;
}

function absentFields(
  properties: SplitDoc["properties"],
  inferred: InferredFields,
): AbsentFrontmatterField[] {
  const fields: AbsentFrontmatterField[] = [];
  if (!("description" in properties)) {
    fields.push({ key: "description", kind: "text", value: inferred.description });
  }
  if (!("tags" in properties) && inferred.tags.length > 0) {
    fields.push({ key: "tags", kind: "tags", value: inferred.tags });
  }
  if (!("status" in properties)) {
    fields.push({ key: "status", kind: "text", value: inferred.status });
  }
  return fields;
}

export function createNoteIntelligence(deps: NoteIntelligenceDeps): NoteIntelligence {
  let enabled = deps.settings.readEnabled();
  let running = false;
  let lastSweep: NoteIntelligenceSweep | null = null;
  let timer: NodeJS.Timeout | null = null;
  let disposed = false;
  // Bounded logging: the first skip logs, repeats count silently.
  let loggedSkip = false;

  const log = (message: string): void => {
    deps.onLog?.(message);
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  async function sweepOne(
    path: string,
    counts: { updated: number; skipped: number },
  ): Promise<void> {
    let content: string;
    try {
      ({ content } = await deps.vault.read(path));
    } catch {
      counts.skipped += 1;
      return;
    }
    const { properties, body } = splitFrontmatter(content);
    if (INFERABLE_KEYS.every((key) => key in properties)) {
      return;
    }
    const inferred = await deps.infer(headCapUtf8(body, BODY_CAP_BYTES));
    if (inferred === null) {
      counts.skipped += 1;
      if (!loggedSkip) {
        loggedSkip = true;
        log(`[note-intelligence] inference failed for ${path} — skipping (logged once)`);
      }
      return;
    }
    const next = addAbsentFrontmatterFields(content, absentFields(properties, inferred));
    if (next === null) {
      counts.skipped += 1;
      return;
    }
    // A concurrent edit refuses rather than clobbers; the next sweep retries.
    const written = await deps.vault
      .writeIfUnchanged(path, content, next)
      .catch(() => ({ applied: false as const, reason: "changed" as const }));
    if (written.applied) {
      counts.updated += 1;
    } else {
      counts.skipped += 1;
    }
  }

  async function sweep(): Promise<NoteIntelligenceSweep> {
    running = true;
    try {
      const tree = await deps.vault.listTree();
      const docs = tree.entries.flatMap((entry) =>
        entry.kind === "file" && entry.path.endsWith(".md") ? [entry.path] : [],
      );
      // Candidate selection reads cheaply first, so a complete note costs one
      // read and no child.
      const candidates: string[] = [];
      for (const path of docs) {
        if (candidates.length >= SWEEP_BATCH) break;
        try {
          const { content } = await deps.vault.read(path);
          const { properties } = splitFrontmatter(content);
          if (!INFERABLE_KEYS.every((key) => key in properties)) {
            candidates.push(path);
          }
        } catch {
          // Unreadable now — the next sweep re-lists.
        }
      }
      const counts = { updated: 0, skipped: 0 };
      for (let at = 0; at < candidates.length; at += SWEEP_CONCURRENCY) {
        const slice = candidates.slice(at, at + SWEEP_CONCURRENCY);
        await Promise.all(slice.map((path) => sweepOne(path, counts)));
      }
      const result: NoteIntelligenceSweep = {
        scanned: docs.length,
        skipped: counts.skipped,
        updated: counts.updated,
      };
      lastSweep = result;
      return result;
    } finally {
      running = false;
    }
  }

  async function runSweepLogged(): Promise<void> {
    try {
      await sweep();
    } catch (cause) {
      log(`[note-intelligence] sweep failed: ${String(cause)}`);
    }
  }

  const scheduleSweep = (): void => {
    if (!enabled || disposed) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void runSweepLogged();
    }, deps.debounceMs ?? SWEEP_DEBOUNCE_MS);
  };

  return {
    status(): NoteIntelligenceStatus {
      return { enabled, lastSweep, running };
    },

    setEnabled(next: boolean): NoteIntelligenceStatus {
      enabled = next;
      deps.settings.writeEnabled(next);
      if (next) {
        // The toggle-on kick: an immediate-ish sweep rather than waiting a
        // quiet period nothing is counting down.
        clearTimer();
        void runSweepLogged();
      } else {
        clearTimer();
      }
      return { enabled, lastSweep, running };
    },

    noteVaultChange(): void {
      scheduleSweep();
    },

    sweepNow(): Promise<NoteIntelligenceSweep> {
      return sweep();
    },

    dispose(): void {
      disposed = true;
      clearTimer();
    },
  };
}
