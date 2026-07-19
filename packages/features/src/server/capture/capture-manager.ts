// ---------------------------------------------------------------------------
// CaptureManager — the durable inbox behind inteligir://append|task. A
// capture is enqueued (persisted to ~/.inteligir/capture-inbox.json — app
// state, never note content), offered to the renderer over onCaptureApply
// (the open-note live-buffer path, the only design with zero lost-update
// window against a dirty editor), and drained host-side onto TODAY's daily
// note when the renderer isn't the right owner: an explicit `not-open` ack,
// a lost ack (timeout), or a crash/cold-launch (drainPendingCaptures on host
// start). Exact-full-line dedupe + the CAS write make every path idempotent —
// effectively exactly-once.
//
// The drain's write is a compare-and-swap on file content: read → dedupe →
// append → re-read-and-compare → write, retried on mismatch, so a write that
// lands between the snapshot and our write (an autosave flush, the agent,
// sync) forces a retry against the fresh bytes instead of being clobbered.
// The default IO is VaultManager's synchronous read/write — one JS turn, no
// awaits — so in-process interleaving cannot occur; the CAS guards the
// cross-process writers. Deliberately NO markSelfSave: an open-but-CLEAN
// editor's watcher classifies the drain as external and reloads the line
// live (a dirty editor took the onCaptureApply path instead).
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  JsonStore,
  inteligirPath,
  rejectLegacyVersion,
  type FsAdapter,
} from "../storage/json-store";
import { emitEvent } from "../events";
import { getUiState } from "../ui-state";
import { getVaultManager } from "../vault/vault";
import { titleFromPath } from "@repo/domain/knowledge/link-extract";
import { dailyNotePath, formatIsoDate } from "@repo/domain/notes/daily-path";
import {
  DAILY_FOLDER_KEY,
  DAILY_FORMAT_KEY,
  DAILY_TEMPLATE_PATH,
  DEFAULT_DAILY_FOLDER,
  DEFAULT_DAILY_FORMAT,
  applyTemplate,
} from "@repo/bridge/daily-notes";
import {
  appendCaptureLine,
  formatCaptureLine,
  hasExactCaptureLine,
  type CaptureKind,
} from "@repo/bridge/deep-link";
import type { CaptureAckOutcome, CaptureApplyEvent } from "@repo/bridge/ipc-registry";

const INBOX_VERSION = 1;
// Inbox bound — a rate-limited surface can't realistically hit this; oldest
// entries drop first so a wedged drain can't grow the file without limit.
const MAX_INBOX_ENTRIES = 200;
/** How long the host waits for the renderer's ack before draining to disk. */
const ACK_TIMEOUT_MS = 2_000;
// CAS retry bound — every retry re-reads, so looping means a pathologically
// hot file; give up and keep the inbox entry for the next drain trigger.
const MAX_CAS_ATTEMPTS = 5;

const CaptureEntrySchema = Type.Object(
  {
    id: Type.String(),
    kind: Type.Union([Type.Literal("append"), Type.Literal("task")]),
    /** Already sanitized by parseDeepLink — the inbox never holds raw input. */
    text: Type.String(),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);

const InboxFileSchema = Type.Object(
  { version: Type.Literal(INBOX_VERSION), entries: Type.Array(CaptureEntrySchema) },
  { additionalProperties: false },
);

type CaptureEntry = Static<typeof CaptureEntrySchema>;

/** The two vault operations the drain needs — injection seam for tests. Both
 * are SYNCHRONOUS (the CAS serialization story depends on it). */
export type CaptureIo = {
  /** Raw file text, or null when the file doesn't exist. */
  read: (rel: string) => string | null;
  /** Atomic write through the vault (its notify semantics ride along). */
  write: (rel: string, content: string) => void;
};

export type CaptureManagerOptions = {
  fs?: FsAdapter;
  /** Override the inbox path (tests). */
  path?: string;
  /** Override the vault IO (tests). Defaults to VaultManager readText/writeText. */
  io?: CaptureIo;
  /** Override today's daily-note path (defaults to ui-state folder/format). */
  dailyPath?: () => string;
  /** Raw daily template bytes, or null (defaults to vault templates/daily.md). */
  readTemplate?: () => string | null;
  /** Push channel for onCaptureApply. Defaults to the typed event bus. */
  onApply?: (event: CaptureApplyEvent) => void;
  /** Ack-timeout override (tests). */
  ackTimeoutMs?: number;
  /** Clock override (tests). */
  now?: () => Date;
};

function defaultIo(): CaptureIo {
  return {
    read: (rel) => {
      try {
        return getVaultManager().readText(rel);
      } catch {
        return null; // missing (or unreadable) — the drain seeds it
      }
    },
    write: (rel, content) => {
      getVaultManager().writeText(rel, content);
    },
  };
}

export class CaptureManager {
  private readonly store: JsonStore<CaptureEntry[]>;
  private readonly io: CaptureIo;
  private readonly dailyPath: () => string;
  private readonly readTemplate: () => string | null;
  private readonly onApply: (event: CaptureApplyEvent) => void;
  private readonly ackTimeoutMs: number;
  private readonly now: () => Date;
  private readonly ackTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(opts: CaptureManagerOptions = {}) {
    this.io = opts.io ?? defaultIo();
    this.dailyPath =
      opts.dailyPath ??
      (() => {
        const uiState = getUiState().getAll();
        const folder = uiState[DAILY_FOLDER_KEY];
        const format = uiState[DAILY_FORMAT_KEY];
        return dailyNotePath(
          typeof folder === "string" ? folder : DEFAULT_DAILY_FOLDER,
          typeof format === "string" ? format : DEFAULT_DAILY_FORMAT,
          this.now(),
        );
      });
    this.readTemplate =
      opts.readTemplate ??
      (() => {
        try {
          return getVaultManager().readText(DAILY_TEMPLATE_PATH);
        } catch {
          return null; // template is optional in every flow
        }
      });
    this.onApply = opts.onApply ?? ((event) => emitEvent("onCaptureApply", event));
    this.ackTimeoutMs = opts.ackTimeoutMs ?? ACK_TIMEOUT_MS;
    this.now = opts.now ?? (() => new Date());
    this.store = new JsonStore<CaptureEntry[]>(
      opts.path ?? inteligirPath("capture-inbox.json"),
      InboxFileSchema,
      [],
      {
        fs: opts.fs,
        versioning: {
          current: INBOX_VERSION,
          // No unversioned era — the inbox is new. Anything without a version
          // field is corrupt (quarantined, reset to empty).
          fromLegacy: rejectLegacyVersion("capture-inbox.json"),
        },
        decode: (raw) => {
          if (!Value.Check(InboxFileSchema, raw)) throw new Error("capture inbox shape rejected");
          return raw.entries;
        },
        encode: (entries) => ({ version: INBOX_VERSION, entries }),
      },
    );
  }

  /** Persist a capture and offer it to the renderer (the open-note live-
   * buffer path). The ack timeout drains it to disk if no verdict arrives —
   * a mid-reload renderer or a lost ack must not strand the entry. */
  enqueue(kind: CaptureKind, text: string): string {
    const entry: CaptureEntry = {
      id: crypto.randomUUID(),
      kind,
      text,
      createdAt: this.now().toISOString(),
    };
    this.store.update((entries) => [...entries, entry].slice(-MAX_INBOX_ENTRIES));
    try {
      this.onApply({
        id: entry.id,
        path: this.dailyPath(),
        line: formatCaptureLine(entry.kind, entry.text),
      });
    } catch (err) {
      console.warn("[capture] apply broadcast failed:", err);
    }
    this.armAckTimer(entry.id);
    return entry.id;
  }

  /** The renderer's verdict. `applied` removes the entry only AFTER the
   * renderer confirmed a flush; `not-open` drains to disk now; `deferred`
   * parks the entry (timer canceled) until the renderer re-acks — a crash
   * while parked is covered by drainPendingCaptures on the next start. */
  ack(id: string, outcome: CaptureAckOutcome): void {
    this.cancelAckTimer(id);
    if (outcome === "applied") {
      this.removeEntry(id);
      return;
    }
    if (outcome === "not-open") {
      const entry = this.store.read().find((e) => e.id === id);
      if (entry !== undefined) this.drainEntry(entry);
    }
    // "deferred": keep the entry, nothing else to do.
  }

  /** Drain every parked entry to disk — host start (crash/cold-launch
   * recovery). Dedupe makes re-runs of already-applied lines no-ops. */
  drainPendingCaptures(): void {
    for (const entry of this.store.read()) {
      this.drainEntry(entry);
    }
  }

  /** Cancel timers + disable the store before ~/.inteligir is wiped. */
  close(): void {
    for (const timer of this.ackTimers.values()) clearTimeout(timer);
    this.ackTimers.clear();
    this.store.close();
  }

  // ---- Internals ------------------------------------------------------------

  private armAckTimer(id: string): void {
    this.cancelAckTimer(id);
    const timer = setTimeout(() => {
      this.ackTimers.delete(id);
      const entry = this.store.read().find((e) => e.id === id);
      if (entry !== undefined) this.drainEntry(entry);
    }, this.ackTimeoutMs);
    this.ackTimers.set(id, timer);
  }

  private cancelAckTimer(id: string): void {
    const timer = this.ackTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.ackTimers.delete(id);
    }
  }

  private removeEntry(id: string): void {
    this.cancelAckTimer(id);
    this.store.update((entries) => entries.filter((e) => e.id !== id));
  }

  /** Land one entry on today's note. A failed write keeps the entry parked
   * for the next drain trigger (start-up, another ack) — never lost. */
  private drainEntry(entry: CaptureEntry): void {
    const path = this.dailyPath();
    const line = formatCaptureLine(entry.kind, entry.text);
    try {
      this.casAppend(path, line);
    } catch (err) {
      console.warn(`[capture] drain of ${entry.id} failed:`, err);
      return;
    }
    this.removeEntry(entry.id);
  }

  /** Compare-and-swap append: dedupe + append against a snapshot, re-read to
   * verify the snapshot still holds, write, verify the line landed. A missing
   * file is seeded from templates/daily.md (placeholders applied) so a deep-
   * link-created daily is identical to a ⌘D-created one. */
  private casAppend(path: string, line: string): void {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const snapshot = this.io.read(path);
      const base = snapshot ?? this.seedContent(path);
      if (hasExactCaptureLine(base, line)) return; // already there — idempotent
      const next = appendCaptureLine(base, line);
      // CAS: another writer (autosave flush, agent, sync) landing between the
      // snapshot and here means `next` was built on stale bytes — retry.
      if (this.io.read(path) !== snapshot) continue;
      this.io.write(path, next);
      const after = this.io.read(path);
      if (after !== null && hasExactCaptureLine(after, line)) return;
    }
    throw new Error(`capture append kept losing the write race on ${path}`);
  }

  private seedContent(path: string): string {
    const template = this.readTemplate();
    if (template === null) return "";
    return applyTemplate(template, {
      title: titleFromPath(path),
      date: formatIsoDate(this.now()),
    });
  }
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors getDelegationManager(). resetCaptureManager() runs
// in teardownAgentResources() before ~/.inteligir is wiped.
// ---------------------------------------------------------------------------

let instance: CaptureManager | null = null;

export function getCaptureManager(): CaptureManager {
  if (!instance) instance = new CaptureManager();
  return instance;
}

export function resetCaptureManager(): void {
  instance?.close();
  instance = null;
}
