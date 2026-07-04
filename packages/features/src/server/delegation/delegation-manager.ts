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

import { DelegationSnapshotStore } from "./delegation-snapshots";
import { findTaskLine } from "./find-task-line";
import { JsonStore, inteligirPath, type FsAdapter } from "../lib/json-store";
import { getVaultManager } from "../vault/vault";
import { parseAgentEvent } from "@repo/features/agent-event-parser";
import {
  DelegationSchema,
  type CreateDelegationParams,
  type CreateDelegationResult,
  type Delegation,
  type RestoreSnapshotResult,
} from "@repo/features/delegation";
import { isRecord, toErrorMessage } from "@repo/features/ipc";

// v2: anchor moved from text/heading matching to a positional `index`.
// v3: pre-run snapshots — records gained `hasSnapshot` + `restoredAt`.
const DELEGATIONS_VERSION = 3;
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

// The subset of the Agent surface a delegation run drives. Structural so the
// real Agent satisfies it and tests can pass a lightweight fake without casts.
export type DelegationAgent = {
  subscribe(listener: (event: unknown) => void): () => void;
  getState(): { status: string };
  sendMessage(message: string): Promise<void>;
  waitForIdle(timeoutMs: number): Promise<boolean>;
  interrupt(): Promise<unknown>;
};

// Change notification — push channel for the editor's inline badges. Wired from
// Electron-side composition (app-machine) so this module stays electron-free.
let changedNotifier: ((delegations: Delegation[]) => void) | null = null;

export function setDelegationsChangedNotifier(
  notifier: ((delegations: Delegation[]) => void) | null,
): void {
  changedNotifier = notifier;
}

// Streaming transcript channel — pushes a delegation's accumulating response
// text (keyed by id) for the live response dock. Same electron-free pattern.
let streamNotifier: ((id: string, text: string) => void) | null = null;

export function setDelegationStreamNotifier(
  notifier: ((id: string, text: string) => void) | null,
): void {
  streamNotifier = notifier;
}

export type DelegationManagerOptions = {
  fs?: FsAdapter;
  path?: string;
  /** Read a vault file's raw text. Defaults to the live VaultManager. */
  readVault?: (rel: string) => string;
  /** Write a vault file (atomic; the watcher broadcasts the change). Defaults
   * to the live VaultManager. Restore goes through here so editors refresh via
   * the standard onVaultChanged path. */
  writeVault?: (rel: string, content: string) => void;
  /** Pre-run snapshot store. Defaults to the real ~/.inteligir-backed one. */
  snapshots?: DelegationSnapshotStore;
};

export class DelegationManager {
  private readonly store: JsonStore<Delegation[]>;
  private readonly readVault: (rel: string) => string;
  private readonly writeVault: (rel: string, content: string) => void;
  private readonly snapshots: DelegationSnapshotStore;
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
    this.snapshots = opts?.snapshots ?? new DelegationSnapshotStore();
    this.store = new JsonStore<Delegation[]>(
      opts?.path ?? inteligirPath("delegations.json"),
      DelegationsFileSchema,
      [],
      {
        fs: opts?.fs,
        versioning: {
          current: DELEGATIONS_VERSION,
          fromLegacy: () => ({ version: DELEGATIONS_VERSION, delegations: [] }),
          // v1 used text/heading anchors the v2 schema can't validate; there's no
          // file access at load time to recompute indices, so reset cleanly. This
          // takes the migration path (silent rewrite) instead of the corrupt-file
          // quarantine path — delegations are transient, so dropping them is fine,
          // but firing a scary "corrupt file" recovery notice for a known prior
          // version is not.
          migrations: {
            1: () => ({ version: DELEGATIONS_VERSION, delegations: [] }),
            // v2 → v3: records gained snapshot bookkeeping. A pre-snapshot
            // record has no snapshot by definition and was never restored.
            2: (raw) => {
              if (!isRecord(raw) || !Array.isArray(raw["delegations"])) {
                throw new Error("v2 delegations shape rejected");
              }
              return {
                version: DELEGATIONS_VERSION,
                delegations: raw["delegations"].map((d: unknown) =>
                  isRecord(d) ? { ...d, hasSnapshot: false, restoredAt: null } : d,
                ),
              };
            },
          },
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
        return { ...d, ...failedPatch("Interrupted — session ended") };
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
        return { ...d, ...failedPatch(reason) };
      }),
    );
    if (changed) this.notify();
  }

  /** Create + enqueue a delegation. Resolves the checkbox line from the vault
   * file first so a stale/edited checkbox is rejected before it queues. */
  createDelegation(params: CreateDelegationParams): CreateDelegationResult {
    if (this.unavailableReason !== null) return { ok: false, error: this.unavailableReason };
    let raw: string;
    try {
      raw = this.readVault(params.sourceFile);
    } catch (err) {
      return { ok: false, error: `Couldn't read ${params.sourceFile}: ${toErrorMessage(err)}` };
    }
    const match = findTaskLine(raw, params.index);
    if (!match) {
      return {
        ok: false,
        error: "That checkbox is no longer in the file — save your edits first.",
      };
    }

    const delegation: Delegation = {
      id: crypto.randomUUID(),
      sourceFile: params.sourceFile,
      anchor: { index: params.index, text: match.text, heading: match.heading },
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
        const next = remapPath(d.sourceFile, from, to);
        if (next === d.sourceFile) return d;
        changed = true;
        return { ...d, sourceFile: next };
      }),
    );
    if (changed) this.notify();
  }

  /** Cancel a still-queued delegation. A running one can't be pulled back. */
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
    this.patch(id, { restoredAt: Date.now() });
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

  private patch(id: string, patch: Partial<Delegation>): void {
    this.store.update((all) => all.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    this.notify();
  }

  /** Apply a terminal status, but only while the record is still `running`. A
   * run can finish (done/timeout/error) after stop() already failed it as
   * interrupted, or after a cancel — without this guard that late patch would
   * resurrect the record (e.g. show "done" after the user was told it stopped). */
  private finishRun(id: string, patch: Partial<Delegation>): void {
    let changed = false;
    this.store.update((all) =>
      all.map((d) => {
        if (d.id !== id || d.status !== "running") return d;
        changed = true;
        return { ...d, ...patch };
      }),
    );
    if (changed) this.notify();
  }

  private notify(): void {
    try {
      changedNotifier?.(this.getDelegations());
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
    const match = findTaskLine(raw, delegation.anchor.index);
    if (!match) {
      return { ok: false, error: "That checkbox is no longer in the file." };
    }
    // The index is an ORDINAL — if a checkbox was inserted/removed above this one
    // while it sat queued, the index now lands on a DIFFERENT task. Both texts are
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
      lineText: match.lineText.trim(),
      anchor: { ...delegation.anchor, heading: match.heading },
    };
    // Persist the refreshed line so the inline badge tracks it too.
    if (
      fresh.lineText !== delegation.lineText ||
      fresh.anchor.heading !== delegation.anchor.heading
    ) {
      this.patch(delegation.id, { lineText: fresh.lineText, anchor: fresh.anchor });
    }
    return { ok: true, delegation: fresh, raw };
  }

  private async run(agent: DelegationAgent, delegation: Delegation): Promise<void> {
    this.patch(delegation.id, { status: "running", startedAt: Date.now() });

    // Re-resolve the checkbox against CURRENT vault bytes — the file may have
    // changed while this sat queued. Send the agent fresh line coordinates, or
    // fail rather than point it at a stale, moved, or already-checked line.
    const resolved = this.resolveForRun(delegation);
    if (!resolved.ok) {
      this.finishRun(delegation.id, failedPatch(resolved.error));
      return;
    }
    const fresh = resolved.delegation;

    // Snapshot the file's pre-run bytes — the undo point "Restore original"
    // writes back. This MUST land before the agent is dispatched: the agent
    // edits the file with its own tools through ./vault, so the host can't
    // intercept the write itself, and an agent edit with no snapshot is an
    // edit the user can't revert. A capture failure therefore aborts the run.
    try {
      this.snapshots.capture(delegation.id, fresh.sourceFile, resolved.raw);
    } catch (err) {
      this.finishRun(
        delegation.id,
        failedPatch(`Couldn't snapshot ${fresh.sourceFile} before running: ${toErrorMessage(err)}`),
      );
      return;
    }
    this.patch(delegation.id, { hasSnapshot: true });

    const captured: { text: string | null } = { text: null };
    let streamed = "";
    const unsubscribe = agent.subscribe((raw) => {
      const event = parseAgentEvent(raw);
      if (!event) return;
      // Build a live transcript for the response dock: the assistant's text
      // deltas + a line per tool call so the user sees what it's doing before it
      // writes anything. Only the final message becomes the persisted summary.
      if (event.type === "message_update") {
        streamed += event.delta;
        streamNotifier?.(delegation.id, streamed);
      } else if (event.type === "tool_execution_start") {
        streamed += `${streamed ? "\n\n" : ""}\`⚙ ${event.toolName}\``;
        streamNotifier?.(delegation.id, streamed);
      } else if (event.type === "message_end" && event.role === "assistant" && event.text) {
        captured.text = event.text;
      }
    });

    try {
      await agent.sendMessage(buildPrompt(fresh));
      const finished = await agent.waitForIdle(RUN_TIMEOUT_MS);
      if (this.stopRequested === delegation.id) {
        this.stopRequested = null;
        this.finishRun(delegation.id, failedPatch("Stopped."));
        return;
      }
      if (!finished) {
        await agent.interrupt().catch(() => {});
        this.finishRun(delegation.id, failedPatch("Timed out"));
        return;
      }
      this.finishRun(delegation.id, {
        status: "done",
        finishedAt: Date.now(),
        resultSummary: captured.text?.trim().slice(0, SUMMARY_LEN) ?? "Done",
      });
    } catch (err) {
      this.finishRun(delegation.id, failedPatch(toErrorMessage(err)));
    } finally {
      unsubscribe();
    }
  }
}

/** Repoint a delegation's source path across a rename/move. Handles an exact
 * file rename and a folder rename (every path under `from/`). Uses `/` — vault
 * paths are POSIX-relative regardless of host OS. */
function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  return path;
}

/** The terminal-failure patch — one shape for every place a run/queue entry ends
 * in failure (interrupt, unavailable, timeout, error, stale anchor). */
function failedPatch(error: string): Partial<Delegation> {
  return { status: "failed", finishedAt: Date.now(), error };
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
  if (!instance) instance = new DelegationManager();
  return instance;
}

export function resetDelegationManager(): void {
  instance?.stop();
  instance = null;
}
