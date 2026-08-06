// ---------------------------------------------------------------------------
// The durable inbox behind the capture verbs — `append` and `task`.
//
// The grammar is unchanged and DELIBERATELY so: `@repo/bridge/deep-link` is
// pure, and this host reuses its parser, its sanitizer, its line formatter, its
// append rule and its exact-line dedupe verbatim. The scheme in front of it is
// what moved — `inteligir://append?text=` was an OS-delivered URL and here it
// is an HTTP request — but the RULE that survived both is the one that matters:
// the target path is computed HOST-side from today's date and the user's
// Settings, never taken from the URL.
//
// The shape is the desktop's: enqueue durably, OFFER the line to the open
// editor (`onCaptureApply`), and drain to the note when the editor is not the
// right owner. Two things about it are different here and both are forced:
//
//   • THE ACK DEADLINE IS THE HOST'S ALARM, not a `setTimeout`. A pending timer
//     pins the Durable Object, which is the hibernation the whole transport
//     exists to get; an alarm survives eviction, so a client that took the
//     offer and then closed its laptop still has its capture drained. It joins
//     the object's ONE alarm through `nextDueAt` — a second alarm concept would
//     silently cancel whatever the first had armed.
//   • THE COMPARE-AND-SWAP IS ON THE MANIFEST VERSION, not on file bytes. The
//     desktop compared bytes because its vault IO was synchronous and a version
//     was not available; here `UserVault.writeText` takes a `baseVersion` and
//     answers a conflict as a VALUE, which is the same guarantee with none of
//     the read-compare-read dance. The exact-line dedupe still runs first, so
//     every retry — and every re-drain after a crash — is idempotent.
//
// The INBOX itself stays a synchronous JsonStore (over the object's KV, through
// the DO adapter). That is a contract, not a preference: `json-store-core`
// documents the adapter as synchronous precisely because a capture's
// read-modify-write must complete in one JS turn, so no other caller can
// interleave between "is this entry still queued" and "it is not".
// ---------------------------------------------------------------------------

import {
  appendCaptureLine,
  formatCaptureLine,
  hasExactCaptureLine,
  type CaptureKind,
} from "@repo/bridge/deep-link";
import { DAILY_TEMPLATE_PATH, applyTemplate } from "@repo/bridge/daily-notes";
import type { CaptureAckOutcome, CaptureApplyEvent } from "@repo/bridge/ipc-registry";
import { formatIsoDate } from "@repo/notes/daily-path";
import { titleFromPath } from "@repo/notes/knowledge/link-extract";
import { createDoStoreAdapter, type SyncKv } from "@repo/storage/do-store-adapter";
import { JsonStoreCore } from "@repo/storage/json-store-core";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type { UserVault } from "../host/vault/user-vault";

const INBOX_VERSION = 1;
const INBOX_KEY = "capture-inbox";

/** Inbox bound — oldest first, so a wedged drain cannot grow the object's
 * storage without limit. */
const MAX_INBOX_ENTRIES = 200;

/** How long the host waits for a client's verdict before draining to the note.
 * Two seconds on the desktop, and longer here because the round trip crosses a
 * network rather than an IPC channel. */
const ACK_TIMEOUT_MS = 5_000;

/** Version-conflict retries. Every retry re-reads, so looping means a
 * pathologically hot note; give up and keep the entry for the next drain. */
const MAX_CAS_ATTEMPTS = 5;

const CaptureEntrySchema = Type.Object(
  {
    id: Type.String(),
    kind: Type.Union([Type.Literal("append"), Type.Literal("task")]),
    /** Already sanitized by `parseDeepLink` — the inbox never holds raw input. */
    text: Type.String(),
    createdAt: Type.Number(),
    /** When the offer stops being the client's to answer, or `null` when the
     * client PARKED it (a transient AI session holds the buffer) and will
     * re-ack. Null rather than a large sentinel because the store round-trips
     * through JSON, where `Infinity` serializes to `null` anyway — one
     * representation is better than two that agree by accident. */
    ackDeadline: Type.Union([Type.Number(), Type.Null()]),
  },
  { additionalProperties: false },
);

const InboxFileSchema = Type.Object(
  { version: Type.Literal(INBOX_VERSION), entries: Type.Array(CaptureEntrySchema) },
  { additionalProperties: false },
);

type CaptureEntry = Static<typeof CaptureEntrySchema>;

export type CaptureInboxDeps = {
  readonly kv: SyncKv;
  readonly vault: UserVault;
  /** TODAY's daily-note path, resolved PER DRAIN rather than at enqueue: a
   * capture parked across midnight belongs to the day it lands on. */
  readonly dailyPath: (now: Date) => string;
  /** Offer the line to the open editor (`onCaptureApply`). */
  readonly onApply: (event: CaptureApplyEvent) => void;
  readonly now: () => number;
};

export class CaptureInbox {
  private readonly deps: CaptureInboxDeps;
  private readonly store: JsonStoreCore<CaptureEntry[]>;

  constructor(deps: CaptureInboxDeps) {
    this.deps = deps;
    this.store = new JsonStoreCore<CaptureEntry[]>(
      createDoStoreAdapter(deps.kv),
      INBOX_KEY,
      InboxFileSchema,
      [],
      {
        versioning: { current: INBOX_VERSION },
        decode: (raw) => {
          if (!Value.Check(InboxFileSchema, raw)) throw new Error("capture inbox shape rejected");
          return raw.entries;
        },
        encode: (entries) => ({ version: INBOX_VERSION, entries }),
      },
    );
  }

  /**
   * Persist a capture and offer it to the open editor.
   *
   * The offer is the ONLY path with no lost-update window against a dirty
   * buffer: a host write to a note the user is editing would be overwritten by
   * the next whole-buffer autosave. Everything else drains here.
   */
  enqueue(kind: CaptureKind, text: string): string {
    const now = this.deps.now();
    const entry: CaptureEntry = {
      id: crypto.randomUUID(),
      kind,
      text,
      createdAt: now,
      ackDeadline: now + ACK_TIMEOUT_MS,
    };
    this.store.update((entries) => [...entries, entry].slice(-MAX_INBOX_ENTRIES));
    this.deps.onApply({
      id: entry.id,
      path: this.deps.dailyPath(new Date(now)),
      line: formatCaptureLine(entry.kind, entry.text),
    });
    return entry.id;
  }

  /**
   * A client's verdict.
   *
   * `applied` removes the entry only after the client confirmed a flush;
   * `not-open` drains now; `deferred` parks it — the deadline is cleared, and a
   * crash while parked is covered by the drain the alarm runs anyway.
   */
  async ack(id: string, outcome: CaptureAckOutcome): Promise<void> {
    if (outcome === "applied") {
      this.remove(id);
      return;
    }
    if (outcome === "deferred") {
      // Park it: no deadline, so the sweep leaves it alone until the client
      // re-acks. Expressed as the deadline's absence rather than a second flag,
      // because the sweep already reads one and two ways to say "not yet" is
      // one too many.
      this.store.update((entries) =>
        entries.map((entry) => (entry.id === id ? { ...entry, ackDeadline: null } : entry)),
      );
      return;
    }
    const entry = this.store.read().find((candidate) => candidate.id === id);
    if (entry !== undefined) await this.drain(entry);
  }

  /** Land every entry whose deadline has passed. Runs on the host's ONE alarm.
   * Idempotent by exact-line dedupe, which at-least-once alarm delivery
   * requires. */
  async sweep(now: number): Promise<void> {
    for (const entry of this.store.read()) {
      if (entry.ackDeadline !== null && entry.ackDeadline <= now) await this.drain(entry);
    }
  }

  /** When the inbox next needs the host awake, or null. */
  nextDueAt(): number | null {
    const deadlines = this.store
      .read()
      .map((entry) => entry.ackDeadline)
      .filter((deadline): deadline is number => deadline !== null);
    return deadlines.length === 0 ? null : Math.min(...deadlines);
  }

  // ---- internals ------------------------------------------------------------

  /** Land one entry on today's note. A failed write keeps the entry queued for
   * the next sweep — a capture is never dropped, only deferred. */
  private async drain(entry: CaptureEntry): Promise<void> {
    const path = this.deps.dailyPath(new Date(this.deps.now()));
    const line = formatCaptureLine(entry.kind, entry.text);
    if (await this.appendOnce(path, line)) this.remove(entry.id);
  }

  /**
   * Append `line` to `path` exactly once, against the manifest version the
   * content was read at.
   *
   * Dedupe FIRST: a re-drain after a crash, a duplicate alarm delivery and a
   * racing ack all reach here with a line that is already in the file, and the
   * whole exactly-once story is that finding it there is a success.
   */
  private async appendOnce(path: string, line: string): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const file = this.deps.vault.lookup(path);
      const live = file !== null && file.state === "live";
      // The TOMBSTONE's version, not zero, when the note was trashed: writing
      // over a tombstone resurrects the row, and passing zero would conflict
      // forever against a manifest row that is still there.
      const baseVersion = file?.version ?? 0;
      let base: string;
      if (live) {
        try {
          base = await this.deps.vault.readText(path);
        } catch {
          return false;
        }
      } else {
        base = await this.seedContent(path);
      }
      if (hasExactCaptureLine(base, line)) return true;

      const written = await this.deps.vault.writeText(
        path,
        appendCaptureLine(base, line),
        baseVersion,
      );
      if (written.ok) return true;
      // A conflict means another writer (an autosave flush, the agent, a
      // routine) landed between the read and the write — re-read and try again
      // against the fresh bytes rather than clobbering them.
      if (written.reason !== "version-conflict") return false;
    }
    return false;
  }

  /** What a missing daily note is created from: the vault's own daily template
   * with its placeholders applied, so a captured line creates a note identical
   * to the one ⌘D would have. */
  private async seedContent(path: string): Promise<string> {
    const template = this.deps.vault.lookup(DAILY_TEMPLATE_PATH);
    if (template === null || template.state !== "live") return "";
    try {
      return applyTemplate(await this.deps.vault.readText(DAILY_TEMPLATE_PATH), {
        title: titleFromPath(path),
        date: formatIsoDate(new Date(this.deps.now())),
      });
    } catch {
      return "";
    }
  }

  private remove(id: string): void {
    this.store.update((entries) => entries.filter((entry) => entry.id !== id));
  }
}
