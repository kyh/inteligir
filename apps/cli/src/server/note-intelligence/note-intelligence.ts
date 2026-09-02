// the sweep only adds fields a note lacks, so its own writes disqualify their
// notes from the next pass and a files-changed echo converges to zero updates.
// an install without the binary answers unavailable and schedules nothing: a
// sweep of zeros must not mean both "nothing to do" and "nothing can be done".

import {
  addAbsentFrontmatterFields,
  splitFrontmatter,
  type AbsentFrontmatterField,
  type SplitDoc,
} from "@repo/notes/markdown/frontmatter";
import type {
  NoteIntelligenceAvailability,
  NoteIntelligenceStatus,
  NoteIntelligenceSweep,
} from "@repo/api/local/note-intelligence/note-intelligence-schema";
import { isNotePath } from "@repo/notes/knowledge/doc-file";
import { isTrashedPath } from "@repo/notes/knowledge/vault-path";

import { headCapUtf8 } from "../head-cap-utf8";
import type { VaultService } from "../vault/vault-service";
import type { InferenceRunner, InferredFields } from "./infer";
import type { NoteIntelligenceSettingsStore } from "./settings-store";

// a classification needs the head, not the whole note.
const BODY_CAP_BYTES = 12_000;
const SWEEP_BATCH = 8;
const SWEEP_CONCURRENCY = 3;
const SWEEP_DEBOUNCE_MS = 30_000;

const INFERABLE_KEYS = ["description", "tags", "status"] as const;

export interface NoteIntelligenceDeps {
  vault: VaultService;
  settings: NoteIntelligenceSettingsStore;
  infer: InferenceRunner;
  availability: NoteIntelligenceAvailability;
  debounceMs?: number;
  onLog?: (message: string) => void;
}

export interface NoteIntelligence {
  status(): NoteIntelligenceStatus;
  setEnabled(enabled: boolean): NoteIntelligenceStatus;
  noteVaultChange(): void;
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

const NO_SWEEP: NoteIntelligenceSweep = { scanned: 0, skipped: 0, updated: 0 };

export function createNoteIntelligence(deps: NoteIntelligenceDeps): NoteIntelligence {
  const usable = deps.availability.kind === "available";
  let enabled = deps.settings.readEnabled();
  let running = false;
  let lastSweep: NoteIntelligenceSweep | null = null;
  let timer: NodeJS.Timeout | null = null;
  let disposed = false;
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
    if (!usable) {
      return NO_SWEEP;
    }
    running = true;
    try {
      const tree = await deps.vault.listTree();
      // never sweep Trash/: restore strips only its own stamp lines, not fields inference wrote.
      const docs = tree.entries.flatMap((entry) =>
        entry.kind === "file" && isNotePath(entry.path) && !isTrashedPath(entry.path)
          ? [entry.path]
          : [],
      );
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
          // unreadable now; the next sweep re-lists.
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
    if (!enabled || disposed || !usable) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void runSweepLogged();
    }, deps.debounceMs ?? SWEEP_DEBOUNCE_MS);
  };

  const snapshot = (): NoteIntelligenceStatus => ({
    availability: deps.availability,
    enabled,
    lastSweep,
    running,
  });

  return {
    status: snapshot,

    setEnabled(next: boolean): NoteIntelligenceStatus {
      enabled = next;
      deps.settings.writeEnabled(next);
      clearTimer();
      if (next && usable) {
        void runSweepLogged();
      }
      return snapshot();
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
