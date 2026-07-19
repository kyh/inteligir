// ---------------------------------------------------------------------------
// DelegationManager — the store + serialized queue behind checkbox delegation.
//
// A delegation is created when the user clicks "Delegate" on a checkbox. It is
// persisted, queued, and run one-at-a-time on the background agent
// (background-agent.ts), which edits the vault file directly: it does the task,
// checks the box off, and appends a short result. The vault watcher then
// refreshes the editor. We track status purely so the UI can show an inline
// badge on the delegated line.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { notePrivacy } from "@repo/domain/markdown/frontmatter";

import { findTaskLine } from "./find-task-line";
import { getSnapshotStore, remapVaultPath, type SnapshotStore } from "../snapshots/snapshot-store";
import {
  JsonStore,
  inteligirPath,
  rejectLegacyVersion,
  type FsAdapter,
} from "../storage/json-store";
import { isSelectedProviderConnected } from "../provider/provider-service";
import { getVaultManager } from "../vault/vault";
import { emitEvent } from "../events";
import { runTextTurn } from "../agent/text-turn";
import {
  DelegationSchema,
  type CreateDelegationParams,
  type CreateDelegationResult,
  type Delegation,
  type RestoreSnapshotResult,
} from "@repo/features/delegation";
import { toErrorMessage } from "@repo/features/wire-helpers";

// v2: anchor moved from text/heading matching to a positional `index`.
// v3: pre-run snapshots — records gained `hasSnapshot` + `restoredAt`.
// v4: anchor field `index` renamed `ordinal` (the name every other task
//     surface uses) — a v3 file quarantines + resets rather than silently
//     reading `undefined` anchors.
const DELEGATIONS_VERSION = 4;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_DELEGATIONS = 200;
const SUMMARY_LEN = 200;
// Re-poll interval when the agent is busy but work is queued (e.g. a prior
// interrupt hasn't settled), so a queued delegation is never stranded.
const BUSY_RETRY_MS = 1000;

const DelegationsFileSchema = Type.Object(
  { version: Type.Literal(DELEGATIONS_VERSION), delegations: Type.Array(DelegationSchema) },
  { additionalProperties: false },
);

// Status-narrowed views of the Delegation union — the transition helpers below
// take the exact variant a transition is legal FROM, so the compiler rejects
// e.g. failing a done record.
type QueuedDelegation = Extract<Delegation, { status: "queued" }>;
type RunningDelegation = Extract<Delegation, { status: "running" }>;

// The subset of the Agent surface a delegation run drives. Structural so the
// real Agent satisfies it and tests can pass a lightweight fake without casts.
export type DelegationAgent = {
  subscribe(listener: (event: unknown) => void): () => void;
  getState(): { status: string };
  sendMessage(message: string): Promise<void>;
  waitForIdle(timeoutMs: number): Promise<boolean>;
  interrupt(): Promise<unknown>;
};

export type DelegationManagerOptions = {
  fs?: FsAdapter;
  path?: string;
  /** Read a vault file's raw text. Defaults to the live VaultManager. */
  readVault?: (rel: string) => string;
  /** Write a vault file (atomic; the watcher broadcasts the change). Defaults
   * to the live VaultManager. Restore goes through here so editors refresh via
   * the standard onVaultChanged path. */
  writeVault?: (rel: string, content: string) => void;
  /** Pre-run snapshot store. Defaults to the shared ~/.inteligir-backed
   * singleton (chat checkpoints live in the same store, under their own
   * origin). */
  snapshots?: SnapshotStore;
  /** Whether the selected AI provider can serve a turn right now. Defaults to
   * the live provider service (isSelectedProviderConnected). Injected like
   * readVault so unit tests stay hermetic. */
  isProviderConnected?: () => boolean;
  /** Push channel for the editor's inline badges — the delegation list changed.
   * The live singleton (getDelegationManager) wires it to the typed emitEvent;
   * unit tests leave it unset (or inject a recorder). */
  onChanged?: (delegations: Delegation[]) => void;
  /** Streaming transcript channel — a delegation's accumulating response text
   * (keyed by id) for the live response dock. Same injection story as onChanged. */
  onStream?: (id: string, text: string) => void;
  /** Called after each run settles. The background agent edits the vault file
   * through ./vault (external to VaultManager), so a completed run's result
   * won't otherwise appear until the window regains focus — this kicks a vault
   * refresh so it shows immediately (vault liveness — CLAUDE.md § Decisions).
   * Defaults to the live vault
   * refresh; unit tests leave it unset. */
  onRunSettled?: () => void;
};

export class DelegationManager {
  private readonly store: JsonStore<Delegation[]>;
  private readonly readVault: (rel: string) => string;
  private readonly writeVault: (rel: string, content: string) => void;
  private readonly snapshots: SnapshotStore;
  private readonly isProviderConnected: () => boolean;
  private readonly onChanged: ((delegations: Delegation[]) => void) | null;
  private readonly onStream: ((id: string, text: string) => void) | null;
  private readonly onRunSettled: (() => void) | null;
  private getAgent: (() => DelegationAgent | null) | null = null;
  private running = false;
  // Id of a running delegation the user asked to stop — the run marks it stopped
  // once the interrupt lands the agent idle.
  private stopRequested: string | null = null;
  // Bumped on stop() to invalidate the in-flight run. A run only owns the queue
  // lock while its captured epoch is still current, so a run abandoned by stop()
  // can't reset the lock a fresh runner now holds (no overlapping execution).
  private runEpoch = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // Set when the background agent can't run delegations at all (e.g. it failed
  // to start). New delegations are rejected with this reason instead of sitting
  // "queued" forever; cleared once a working runner is wired.
  private unavailableReason: string | null = null;

  constructor(opts?: DelegationManagerOptions) {
    this.readVault = opts?.readVault ?? ((rel) => getVaultManager().readText(rel));
    this.writeVault =
      opts?.writeVault ?? ((rel, content) => getVaultManager().writeText(rel, content));
    this.snapshots = opts?.snapshots ?? getSnapshotStore();
    this.isProviderConnected = opts?.isProviderConnected ?? isSelectedProviderConnected;
    this.onChanged = opts?.onChanged ?? null;
    this.onStream = opts?.onStream ?? null;
    this.onRunSettled = opts?.onRunSettled ?? null;
    this.store = new JsonStore<Delegation[]>(
      opts?.path ?? inteligirPath("delegations.json"),
      DelegationsFileSchema,
      [],
      {
        fs: opts?.fs,
        versioning: {
          current: DELEGATIONS_VERSION,
          // Pre-v3 formats predate launch — no released build ever wrote them.
          // A stray dev-machine file quarantines once and resets; delegations
          // are documented transient, so nothing of value is lost.
          fromLegacy: rejectLegacyVersion("delegations.json"),
        },
        decode: (raw) => {
          if (!Value.Check(DelegationsFileSchema, raw))
            throw new Error("delegations shape rejected");
          return raw.delegations;
        },
        encode: (delegations) => ({ version: DELEGATIONS_VERSION, delegations }),
      },
    );
  }

  getDelegations(): Delegation[] {
    return this.store.read();
  }

  /** Wire the background agent accessor + kick the queue (a delegation may have
   * been queued before the agent was ready). */
  setRunner(getAgent: () => DelegationAgent | null): void {
    this.getAgent = getAgent;
    this.unavailableReason = null;
    void this.processNext();
  }

  stop(): void {
    this.getAgent = null;
    // Invalidate any in-flight run and release the lock. The abandoned run won't
    // touch the lock when it settles (its epoch is now stale), so resetting here
    // is safe and a fresh setRunner() can drain the queue without a second run
    // racing the abandoned one.
    this.runEpoch++;
    this.running = false;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // The agent was torn down (Cmd+K / logout / shutdown) — fail any in-flight
    // run so it doesn't sit "running" forever and wedge the queue.
    let changed = false;
    this.store.update((all) =>
      all.map((d) => {
        if (d.status !== "running") return d;
        changed = true;
        return toFailed(d, "Interrupted — session ended");
      }),
    );
    if (changed) this.notify();
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.processNext();
    }, BUSY_RETRY_MS);
  }

  /** Mark delegation unavailable (the background agent failed to start). Fail
   * every still-queued delegation so they don't sit "Queued" forever, and
   * reject new ones until a runner is wired. */
  markUnavailable(reason: string): void {
    this.unavailableReason = reason;
    this.getAgent = null;
    let changed = false;
    this.store.update((all) =>
      all.map((d) => {
        if (d.status !== "queued") return d;
        changed = true;
        return toFailed(d, reason);
      }),
    );
    if (changed) this.notify();
  }

  /** Create + enqueue a delegation. Resolves the checkbox line from the vault
   * file first so a stale/edited checkbox is rejected before it queues. */
  createDelegation(params: CreateDelegationParams): CreateDelegationResult {
    if (this.unavailableReason !== null) return { ok: false, error: this.unavailableReason };
    // A guest is the DEFAULT (#459): with no connected provider the background
    // agent can only fail the run silently, so refuse up front — a per-attempt
    // refusal like the private-note one, not a global unavailable latch.
    if (!this.isProviderConnected()) {
      return { ok: false, error: "Connect an AI provider in Settings → AI to delegate." };
    }
    let raw: string;
    try {
      raw = this.readVault(params.sourceFile);
    } catch (err) {
      return { ok: false, error: `Couldn't read ${params.sourceFile}: ${toErrorMessage(err)}` };
    }
    // Private notes never reach the background agent — the whole file rides
    // the delegation prompt's context via the agent's file tools. Fail-closed:
    // unreadable frontmatter counts as private.
    if (notePrivacy(raw) !== "public") {
      return {
        ok: false,
        error: "This note is private — delegating would send its content to the AI provider.",
      };
    }
    const match = findTaskLine(raw, params.ordinal);
    if (!match) {
      return {
        ok: false,
        error: "That checkbox is no longer in the file — save your edits first.",
      };
    }

    const delegation: Delegation = {
      id: crypto.randomUUID(),
      sourceFile: params.sourceFile,
      anchor: { ordinal: params.ordinal, text: match.text, heading: match.heading },
      lineText: match.lineText.trim(),
      status: "queued",
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      resultSummary: null,
      error: null,
      hasSnapshot: false,
      restoredAt: null,
    };
    this.store.update((all) => {
      const next = [...all, delegation];
      if (next.length <= MAX_DELEGATIONS) return next;
      // Over the cap: evict the OLDEST terminal (done/failed) records, never a
      // queued/running one — dropping work the user is waiting on would make its
      // badge vanish with no feedback. If there aren't enough terminal records to
      // trim, we keep slightly more than the cap rather than lose active work.
      let toDrop = next.length - MAX_DELEGATIONS;
      return next.filter((d) => {
        if (toDrop > 0 && (d.status === "done" || d.status === "failed")) {
          toDrop--;
          return false;
        }
        return true;
      });
    });
    this.notify();
    void this.processNext();
    return { ok: true, delegation };
  }

  /** A vault file or folder was renamed/moved — repoint delegations from the old
   * path so inline badges keep matching and queued runs target the new location.
   * Rename doesn't change file content, so the positional anchor stays valid. (A
   * rename mid-run can't be fully repaired — the in-flight prompt already has the
   * old path — but the record is corrected for the badge and any retry.) */
  renameSource(from: string, to: string): void {
    let changed = false;
    this.store.update((all) =>
      all.map((d) => {
        const next = remapVaultPath(d.sourceFile, from, to);
        if (next === d.sourceFile) return d;
        changed = true;
        return { ...d, sourceFile: next };
      }),
    );
    if (changed) this.notify();
  }

  /** Cancel a delegation: interrupt it if running (it marks stopped once idle),
   * or drop it if still queued. Returns whether anything was cancelled. */
  cancelDelegation(id: string): { ok: boolean } {
    // Running: interrupt the agent; the run marks it stopped once it goes idle.
    if (this.getDelegations().some((d) => d.id === id && d.status === "running")) {
      this.stopRequested = id;
      void this.getAgent?.()
        ?.interrupt()
        .catch(() => {});
      return { ok: true };
    }
    // Queued: drop it from the queue.
    let changed = false;
    this.store.update((all) =>
      all.filter((d) => {
        if (d.id === id && d.status === "queued") {
          changed = true;
          return false;
        }
        return true;
      }),
    );
    if (changed) this.notify();
    return { ok: changed };
  }

  /** Restore the file bytes captured before this delegation ran. The write
   * targets the delegation's CURRENT sourceFile (renameSource keeps it pointing
   * at the moved file), goes through the vault's atomic write (the watcher
   * refreshes editors naturally), and recreates the file if it was deleted
   * since. Restoring while the delegation is still queued/running is rejected —
   * it would race the agent's own edits. When the file already matches the
   * snapshot the restore is a no-op success (no write, no watcher churn);
   * `restoredAt` is recorded either way, since the user's intent succeeded. */
  restoreSnapshot(id: string): RestoreSnapshotResult {
    const delegation = this.getDelegations().find((d) => d.id === id);
    if (!delegation) return { ok: false, error: "Unknown delegation." };
    if (delegation.status === "queued" || delegation.status === "running") {
      return { ok: false, error: "Wait for the delegation to finish before restoring." };
    }
    const snapshot = this.snapshots.read(id);
    if (!snapshot.ok) return { ok: false, error: snapshot.error };

    // Byte-equality IS hash-equality here — the snapshot's recorded hash was
    // already verified against its content in read().
    let current: string | null;
    try {
      current = this.readVault(delegation.sourceFile);
    } catch {
      current = null; // deleted (or unreadable) — the write below recreates it
    }
    if (current !== snapshot.content) {
      try {
        this.writeVault(delegation.sourceFile, snapshot.content);
      } catch (err) {
        return {
          ok: false,
          error: `Couldn't restore ${delegation.sourceFile}: ${toErrorMessage(err)}`,
        };
      }
    }
    // The queued/running guard above makes the record terminal here — the only
    // variants that carry a settable restoredAt.
    this.patch(id, (d) =>
      d.status === "done" || d.status === "failed" ? { ...d, restoredAt: Date.now() } : d,
    );
    return { ok: true };
  }

  /** Retention sweep for the snapshot store — run once at host start. Pruned
   * records lose `hasSnapshot` at the data level so no surface (present or
   * future) can offer a restore whose bytes are gone. */
  pruneSnapshots(): void {
    const prunedIds = new Set(this.snapshots.prune());
    if (prunedIds.size === 0) return;
    this.store.update((all) =>
      all.map((d) => (prunedIds.has(d.id) && d.hasSnapshot ? { ...d, hasSnapshot: false } : d)),
    );
  }

  /** Rewrite the record with `id` through `transform` (identity for every
   * other record) and notify. Transforms narrow on `status` themselves, so an
   * illegal transition is a compile error, not a runtime surprise. */
  private patch(id: string, transform: (d: Delegation) => Delegation): void {
    this.store.update((all) => all.map((d) => (d.id === id ? transform(d) : d)));
    this.notify();
  }

  /** Apply a terminal transition, but only while the record is still `running`.
   * A run can finish (done/timeout/error) after stop() already failed it as
   * interrupted, or after a cancel — without this guard that late patch would
   * resurrect the record (e.g. show "done" after the user was told it stopped). */
  private finishRun(id: string, transition: (d: RunningDelegation) => Delegation): void {
    let changed = false;
    this.store.update((all) =>
      all.map((d) => {
        if (d.id !== id || d.status !== "running") return d;
        changed = true;
        return transition(d);
      }),
    );
    if (changed) this.notify();
  }

  private notify(): void {
    try {
      this.onChanged?.(this.getDelegations());
    } catch (err) {
      console.warn("[delegation] change notification failed:", err);
    }
  }

  /** Run the oldest queued delegation if the agent is free. Re-entrant-safe via
   * `running`; re-invokes itself after each run so the queue drains. */
  private async processNext(): Promise<void> {
    if (this.running) return;
    const agent = this.getAgent?.();
    if (!agent) return;
    if (agent.getState().status === "busy") {
      // Busy but nothing re-triggers us once it frees (e.g. a timed-out run left
      // it busy after interrupt) — poll so queued work isn't stranded.
      if (this.getDelegations().some((d) => d.status === "queued")) this.scheduleRetry();
      return;
    }
    const next = this.getDelegations().find((d) => d.status === "queued");
    if (!next) return;

    this.running = true;
    const epoch = this.runEpoch;
    try {
      await this.run(agent, next);
    } catch (err) {
      console.error("[delegation] run failed:", err);
    } finally {
      // Only the current run owns the lock + pump. A run abandoned by stop()
      // (epoch bumped) must not reset the lock a new runner now holds, nor
      // re-enter the queue — that would start a second concurrent run.
      if (epoch === this.runEpoch) {
        this.running = false;
        // The run edited the vault file directly through ./vault — refresh the
        // snapshot so the result appears without waiting for window focus.
        try {
          this.onRunSettled?.();
        } catch (err) {
          console.warn("[delegation] run-settled refresh failed:", err);
        }
        void this.processNext();
      }
    }
  }

  /** Re-resolve a delegation's checkbox against the file's current bytes and
   * refresh its line/anchor so the prompt is never stale. Returns those exact
   * bytes (`raw`) so the pre-run snapshot captures precisely the content the
   * run was resolved against. Synchronous (no await before the first agent
   * call), so stop() can't interleave here. */
  private resolveForRun(
    delegation: Delegation,
  ): { ok: true; delegation: Delegation; raw: string } | { ok: false; error: string } {
    let raw: string;
    try {
      raw = this.readVault(delegation.sourceFile);
    } catch (err) {
      return { ok: false, error: `Couldn't read ${delegation.sourceFile}: ${toErrorMessage(err)}` };
    }
    // The note may have turned private while this sat queued — re-check at
    // dispatch, same fail-closed rule as createDelegation.
    if (notePrivacy(raw) !== "public") {
      return {
        ok: false,
        error: "This note is private — delegating would send its content to the AI provider.",
      };
    }
    const match = findTaskLine(raw, delegation.anchor.ordinal);
    if (!match) {
      return { ok: false, error: "That checkbox is no longer in the file." };
    }
    // The anchor is an ORDINAL — if a checkbox was inserted/removed above this
    // one while it sat queued, it now lands on a DIFFERENT task. Both texts are
    // this module's own extraction (captured at create time vs now), so comparing
    // them is consistent. On a mismatch, fail safe rather than have the agent act
    // on the wrong task — a delegated action can be irreversible (email, calendar).
    if (match.text !== delegation.anchor.text) {
      return {
        ok: false,
        error: "The note changed since you delegated this — re-delegate the task.",
      };
    }
    const fresh: Delegation = {
      ...delegation,
      // UNTRIMMED, deliberately: this is the exact raw line the run was
      // resolved against — the guarded-write input (guarded-line-edit's
      // expectedRaw contract) — so any future host-side write-back has its
      // guard bytes on record. Same string shape, no schema bump.
      lineText: match.lineText,
      anchor: { ...delegation.anchor, heading: match.heading },
    };
    // Persist the refreshed line so the inline badge tracks it too.
    if (
      fresh.lineText !== delegation.lineText ||
      fresh.anchor.heading !== delegation.anchor.heading
    ) {
      this.patch(delegation.id, (d) => ({ ...d, lineText: fresh.lineText, anchor: fresh.anchor }));
    }
    return { ok: true, delegation: fresh, raw };
  }

  private async run(agent: DelegationAgent, delegation: Delegation): Promise<void> {
    this.patch(delegation.id, (d) =>
      d.status === "queued" ? { ...d, status: "running", startedAt: Date.now() } : d,
    );

    // Re-resolve the checkbox against CURRENT vault bytes — the file may have
    // changed while this sat queued. Send the agent fresh line coordinates, or
    // fail rather than point it at a stale, moved, or already-checked line.
    const resolved = this.resolveForRun(delegation);
    if (!resolved.ok) {
      this.finishRun(delegation.id, (d) => toFailed(d, resolved.error));
      return;
    }
    const fresh = resolved.delegation;

    // Snapshot the file's pre-run bytes — the undo point "Restore original"
    // writes back. This MUST land before the agent is dispatched: the agent
    // edits the file with its own tools through ./vault, so the host can't
    // intercept the write itself, and an agent edit with no snapshot is an
    // edit the user can't revert. A capture failure therefore aborts the run.
    try {
      this.snapshots.capture(
        { id: delegation.id, origin: "delegation", path: fresh.sourceFile, kind: "edit" },
        resolved.raw,
      );
    } catch (err) {
      this.finishRun(delegation.id, (d) =>
        toFailed(d, `Couldn't snapshot ${fresh.sourceFile} before running: ${toErrorMessage(err)}`),
      );
      return;
    }
    this.patch(delegation.id, (d) => (d.status === "running" ? { ...d, hasSnapshot: true } : d));

    // Build a live transcript for the response dock: the assistant's text deltas
    // + a line per tool call so the user sees what it's doing before it writes
    // anything. Only the turn's final message becomes the persisted summary.
    let streamed = "";
    const result = await runTextTurn(agent, buildPrompt(fresh), {
      timeoutMs: RUN_TIMEOUT_MS,
      onDelta: (delta) => {
        streamed += delta;
        this.onStream?.(delegation.id, streamed);
      },
      onToolCall: (toolName) => {
        streamed += `${streamed ? "\n\n" : ""}\`⚙ ${toolName}\``;
        this.onStream?.(delegation.id, streamed);
      },
    });

    // A thrown send/wait failure fails the run outright and — matching the
    // original catch — is never reinterpreted as a user stop.
    if (!result.ok && result.kind === "error") {
      this.finishRun(delegation.id, (d) => toFailed(d, result.error));
      return;
    }
    // A stop the user requested wins over a timeout, exactly as before (the stop
    // path already interrupted the agent).
    if (this.stopRequested === delegation.id) {
      this.stopRequested = null;
      this.finishRun(delegation.id, (d) => toFailed(d, "Stopped."));
      return;
    }
    if (!result.ok) {
      this.finishRun(delegation.id, (d) => toFailed(d, "Timed out"));
      return;
    }
    this.finishRun(delegation.id, (d) => ({
      ...d,
      status: "done",
      finishedAt: Date.now(),
      resultSummary: result.text.length > 0 ? result.text.trim().slice(0, SUMMARY_LEN) : "Done",
    }));
  }
}

/** The terminal-failure transition — one shape for every place a queued or
 * running record ends in failure (interrupt, unavailable, timeout, error,
 * stale anchor). Only those two variants can fail; a terminal record stays. */
function toFailed(d: QueuedDelegation | RunningDelegation, error: string): Delegation {
  return { ...d, status: "failed", finishedAt: Date.now(), error };
}

/** The instruction the background agent runs. It edits the file directly. */
function buildPrompt(d: Delegation): string {
  const where = d.anchor.heading ? ` under the "${d.anchor.heading}" section` : "";
  return [
    `You've been delegated a single to-do item from a markdown note. Do it, then record the outcome in the file.`,
    ``,
    `File: ./vault/${d.sourceFile}`,
    `Task${where}: ${d.anchor.text}`,
    ``,
    `Steps:`,
    `1. Do the task. Use your file tools and any connected tools (calendar, email, web, etc.) as needed.`,
    `2. In ./vault/${d.sourceFile}, find the line "${d.lineText}" and change its checkbox from "[ ]" to "[x]".`,
    `3. Immediately under that line, add a nested sub-item with a one-line result, indented two spaces DEEPER than the checkbox line's own indentation (its "-" should sit under the checkbox's text — so a top-level task gets a 2-space indent, a once-nested task 4, and so on), e.g. "  - ✅ <what you did>". If you couldn't complete it, note why instead and leave the checkbox unchecked.`,
    `Keep edits minimal — change only those lines. Don't reformat the rest of the file. Reply with a one-sentence summary of what you did.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors the vault/task managers.
// ---------------------------------------------------------------------------

let instance: DelegationManager | null = null;

export function getDelegationManager(): DelegationManager {
  if (!instance) {
    // Wire the push channels straight to the typed event bus (events.ts is a
    // leaf module — no cycle risk). emitEvent is process-global, so an
    // instance rebuilt after a logout/login reset stays wired.
    instance = new DelegationManager({
      onChanged: (delegations) => emitEvent("onDelegationsUpdated", { delegations }),
      onStream: (id, text) => emitEvent("onDelegationStreamed", { id, text }),
      onRunSettled: () => getVaultManager().refresh(),
    });
  }
  return instance;
}

export function resetDelegationManager(): void {
  instance?.stop();
  instance = null;
}
