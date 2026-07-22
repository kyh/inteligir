// ---------------------------------------------------------------------------
// RoutinesManager — the store + scheduler + serialized runner behind scheduled
// agent routines. The sibling of DelegationManager, deliberately shaped like
// it: a versioned JsonStore (routines.json), a one-run-at-a-time queue on the
// SHARED background pi session (serialized against delegation through the
// BackgroundTurnLock — the two managers never run concurrent turns on it),
// runTextTurn for the turn mechanics, and a pre-run RestoreManager snapshot so
// every routine edit is undoable.
//
// The risk shape is different from delegation, and the design leans on that:
// a routine runs UNPROMPTED on a timer, so the write path is host-owned — the
// agent is instructed to REPLY with markdown (not to edit files), and the
// HOST appends that reply to the target note through the confined VaultManager
// write. Combined with the pre-dispatch snapshot, the worst a scheduled run
// can do to its target is an appended block the user can restore away. (The
// background session's file tools still exist — see the prompt — so an agent
// that disobeys and edits some OTHER file is uncovered, exactly like
// delegation's off-target edits; the privacy gate still guards private notes
// from those tools either way.)
//
// Scheduling is a coarse boot-time interval over the PURE due computation
// (@repo/bridge/routine-schedule): every tick asks "has this routine's latest
// slot passed since it last ran?" — which also gives missed-slot catch-up on
// launch (once, not N times) for free. lastRunAt is stamped at DISPATCH, so a
// crash mid-run skips to the next slot rather than re-firing.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { notePrivacy } from "@repo/notes/markdown/frontmatter";
import { dailyNotePath, formatIsoDate } from "@repo/notes/daily-path";

import {
  DAILY_FOLDER_KEY,
  DAILY_FORMAT_KEY,
  DEFAULT_DAILY_FOLDER,
  DEFAULT_DAILY_FORMAT,
} from "@repo/bridge/daily-notes";
import { isRoutineDue } from "@repo/bridge/routine-schedule";
import {
  RoutineSchema,
  type ListRoutinesResult,
  type Routine,
  type RoutineLastRun,
  type RunRoutineNowResult,
  type UpsertRoutineParams,
  type UpsertRoutineResult,
} from "@repo/bridge/routines";
import type { RestoreSnapshotResult } from "@repo/bridge/delegation";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import { runTextTurn } from "@repo/agent/text-turn";
import {
  JsonStore,
  inteligirPath,
  rejectLegacyVersion,
  type FsAdapter,
} from "@repo/storage/json-store";
import { isEnoent } from "@repo/storage/fs-errors";
import { getVaultManager } from "@repo/vault/vault";

import {
  BackgroundTurnLock,
  getBackgroundTurnLock,
  type BackgroundTurnToken,
} from "../delegation/background-turn-lock";
import type { DelegationAgent } from "../delegation/delegation-manager";
import { remapVaultPath } from "../restore/snapshot-store";
import { getRestoreManager, type RestoreManager } from "../restore/restore-manager";
import { isSelectedProviderConnected } from "../provider/provider-service";
import { getUiState } from "../ui-state";
import { emitEvent } from "../events";

const ROUTINES_VERSION = 1;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const SUMMARY_LEN = 200;
const MAX_ROUTINES = 50;
// Coarse due-check cadence. A minute of slack on a notes routine is free, and
// the tick is one pure comparison per routine — no disk, no parse.
const SCHEDULER_INTERVAL_MS = 60 * 1000;
// Re-poll when the background session is busy (a delegation turn, or a prior
// interrupt still settling) so a queued routine is never stranded.
const BUSY_RETRY_MS = 1000;

const RoutinesFileSchema = Type.Object(
  { version: Type.Literal(ROUTINES_VERSION), routines: Type.Array(RoutineSchema) },
  { additionalProperties: false },
);

const PRIVATE_TARGET_ERROR =
  "The target note is private — running would send its content to the AI provider.";

/** One queued run. `manual` (Run now) runs even a disabled routine — it's the
 * test-your-config affordance; a scheduled entry re-checks `enabled` at
 * dispatch so a disable-while-queued sticks. */
type PendingRun = { id: string; manual: boolean };

export type RoutinesManagerOptions = {
  fs?: FsAdapter;
  path?: string;
  /** Read a vault file's raw text (throws ENOENT when absent). Defaults to
   * the live VaultManager. */
  readVault?: (rel: string) => string;
  /** Write a vault file (atomic; the open-note watcher broadcasts). Defaults
   * to the live VaultManager. */
  writeVault?: (rel: string, content: string) => void;
  /** The AI-edit-undo seam, shared with chat + delegation. */
  restore?: RestoreManager;
  /** Whether the selected AI provider can serve a turn right now. */
  isProviderConnected?: () => boolean;
  /** Injected clock — every due decision and timestamp reads it, so tests
   * drive time by hand. Defaults to the real clock. */
  clock?: () => Date;
  /** Resolve TODAY's daily-note path (defaults to the ui-state Settings →
   * Notes folder/format, same as the capture drain). */
  dailyPath?: (now: Date) => string;
  /** Push channel — the routine list (or the running id) changed. */
  onChanged?: (result: ListRoutinesResult) => void;
  /** Called after each run settles — kicks a vault refresh so the appended
   * result shows without waiting for window focus (vault liveness). */
  onRunSettled?: () => void;
  /** Cross-manager serialization for the shared background session (see
   * BackgroundTurnLock). The live singleton passes the process-wide lock. */
  turnLock?: BackgroundTurnLock;
};

export class RoutinesManager {
  private readonly store: JsonStore<Routine[]>;
  private readonly readVault: (rel: string) => string;
  private readonly writeVault: (rel: string, content: string) => void;
  private readonly restore: RestoreManager;
  private readonly isProviderConnected: () => boolean;
  private readonly clock: () => Date;
  private readonly dailyPath: (now: Date) => string;
  private readonly onChanged: ((result: ListRoutinesResult) => void) | null;
  private readonly onRunSettled: (() => void) | null;
  private readonly turnLock: BackgroundTurnLock;

  private getAgent: (() => DelegationAgent | null) | null = null;
  private unavailableReason: string | null = null;
  private pending: PendingRun[] = [];
  private runningId: string | null = null;
  private heldToken: BackgroundTurnToken | null = null;
  // Bumped on stop() to invalidate the in-flight run (delegation's epoch
  // pattern): an abandoned run must not clear the running state a fresh
  // wiring now owns, nor re-enter the queue.
  private runEpoch = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: RoutinesManagerOptions) {
    this.readVault = opts?.readVault ?? ((rel) => getVaultManager().readText(rel));
    this.writeVault =
      opts?.writeVault ?? ((rel, content) => getVaultManager().writeText(rel, content));
    this.restore = opts?.restore ?? getRestoreManager();
    this.isProviderConnected = opts?.isProviderConnected ?? isSelectedProviderConnected;
    this.clock = opts?.clock ?? (() => new Date());
    this.dailyPath =
      opts?.dailyPath ??
      ((now) => {
        const uiState = getUiState().getAll();
        const folder = uiState[DAILY_FOLDER_KEY];
        const format = uiState[DAILY_FORMAT_KEY];
        return dailyNotePath(
          typeof folder === "string" ? folder : DEFAULT_DAILY_FOLDER,
          typeof format === "string" ? format : DEFAULT_DAILY_FORMAT,
          now,
        );
      });
    this.onChanged = opts?.onChanged ?? null;
    this.onRunSettled = opts?.onRunSettled ?? null;
    this.turnLock = opts?.turnLock ?? new BackgroundTurnLock();
    this.store = new JsonStore<Routine[]>(
      opts?.path ?? inteligirPath("routines.json"),
      RoutinesFileSchema,
      [],
      {
        fs: opts?.fs,
        versioning: {
          current: ROUTINES_VERSION,
          // routines.json was born versioned; nothing legacy can exist.
          fromLegacy: rejectLegacyVersion("routines.json"),
        },
        decode: (raw) => {
          if (!Value.Check(RoutinesFileSchema, raw)) throw new Error("routines shape rejected");
          return raw.routines;
        },
        encode: (routines) => ({ version: ROUTINES_VERSION, routines }),
      },
    );
  }

  list(): ListRoutinesResult {
    return { routines: this.store.read(), runningId: this.runningId };
  }

  /** Create (no id) or edit (with id) a routine's config. Host-owned run
   * bookkeeping is preserved across edits; a new routine's createdAt floor is
   * NOW, so slots that passed before it existed never fire. */
  upsert(params: UpsertRoutineParams): UpsertRoutineResult {
    // UX-side privacy check at save time (run time re-checks — the note can
    // turn private later; that check is the authoritative one).
    if (params.target.kind === "note") {
      let raw: string | null = null;
      try {
        raw = this.readVault(params.target.path);
      } catch (err) {
        if (!isEnoent(err)) {
          return {
            ok: false,
            error: `Couldn't read ${params.target.path}: ${toErrorMessage(err)}`,
          };
        }
      }
      if (raw !== null && notePrivacy(raw) !== "public") {
        return { ok: false, error: PRIVATE_TARGET_ERROR };
      }
    }
    const all = this.store.read();
    if (params.id === undefined) {
      if (all.length >= MAX_ROUTINES) {
        return { ok: false, error: `Routine limit reached (${MAX_ROUTINES}).` };
      }
      const routine: Routine = {
        id: crypto.randomUUID(),
        name: params.name,
        prompt: params.prompt,
        schedule: params.schedule,
        target: params.target,
        enabled: params.enabled,
        createdAt: this.clock().getTime(),
        lastRunAt: null,
        lastRun: null,
      };
      this.store.update((current) => [...current, routine]);
      this.notify();
      return { ok: true, routine };
    }
    const existing = all.find((r) => r.id === params.id);
    if (!existing) return { ok: false, error: "Unknown routine." };
    const updated: Routine = {
      ...existing,
      name: params.name,
      prompt: params.prompt,
      schedule: params.schedule,
      target: params.target,
      enabled: params.enabled,
    };
    this.store.update((current) => current.map((r) => (r.id === updated.id ? updated : r)));
    this.notify();
    return { ok: true, routine: updated };
  }

  /** Delete a routine. An in-flight run of it finishes against thin air (its
   * terminal patch no-ops); queued entries are dropped. */
  delete(id: string): { ok: boolean } {
    let removed = false;
    this.store.update((all) =>
      all.filter((r) => {
        if (r.id === id) {
          removed = true;
          return false;
        }
        return true;
      }),
    );
    this.pending = this.pending.filter((p) => p.id !== id);
    if (removed) this.notify();
    return { ok: removed };
  }

  /** Queue an immediate run (the Settings "Run now" — also the way to test a
   * disabled routine's config). Refusals mirror createDelegation: immediate
   * feedback, never a silent queue. */
  runNow(id: string): RunRoutineNowResult {
    if (this.unavailableReason !== null) return { ok: false, error: this.unavailableReason };
    if (!this.isProviderConnected()) {
      return { ok: false, error: "Connect an AI provider in Settings → AI to run routines." };
    }
    const routine = this.store.read().find((r) => r.id === id);
    if (!routine) return { ok: false, error: "Unknown routine." };
    if (this.runningId === id || this.pending.some((p) => p.id === id)) {
      return { ok: false, error: "This routine is already running." };
    }
    this.pending.push({ id, manual: true });
    void this.processNext();
    return { ok: true };
  }

  /** Wire the background agent accessor, start the scheduler, and run the
   * missed-slot catch-up check immediately (launch = the first tick). */
  setRunner(getAgent: () => DelegationAgent | null): void {
    this.getAgent = getAgent;
    this.unavailableReason = null;
    if (this.schedulerTimer === null) {
      this.schedulerTimer = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
      // Don't let the scheduler keep a quitting host process alive.
      this.schedulerTimer.unref();
    }
    this.tick();
  }

  /** The background agent can't serve routines at all (failed to start).
   * Scheduled work stays put — slots aren't consumed — and Run now gets the
   * reason instead of a silent queue. */
  markUnavailable(reason: string): void {
    this.unavailableReason = reason;
    this.getAgent = null;
  }

  stop(): void {
    this.getAgent = null;
    this.runEpoch++;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.pending = [];
    // Release the shared-session token (the session is being torn down) so
    // delegation's fresh runner isn't blocked behind our abandoned run.
    if (this.heldToken !== null) {
      this.turnLock.release(this.heldToken);
      this.heldToken = null;
    }
    // Clear the in-flight run's live state. Its terminal outcome writes are
    // epoch-guarded (run() captured the pre-bump epoch), so the abandoned run
    // can't later overwrite state this teardown just settled — "running" is
    // in-memory only, so nothing on disk can wedge. The routine simply keeps
    // its previous lastRun; the interrupted attempt fires again next slot
    // (lastRunAt was stamped at dispatch, so only after ANOTHER slot passes).
    if (this.runningId !== null) {
      this.runningId = null;
      this.notify();
    }
  }

  /** Restore the target's pre-run bytes from the LAST run's snapshot. */
  async restoreLastRun(id: string): Promise<RestoreSnapshotResult> {
    const routine = this.store.read().find((r) => r.id === id);
    if (!routine) return { ok: false, error: "Unknown routine." };
    if (this.runningId === id || this.pending.some((p) => p.id === id)) {
      return { ok: false, error: "Wait for the routine to finish before restoring." };
    }
    const lastRun = routine.lastRun;
    if (lastRun === null || !lastRun.hasSnapshot) {
      return { ok: false, error: "No saved copy exists for this routine's last run." };
    }
    const result = await this.restore.restoreRoutineSnapshot(lastRun.runId, lastRun.path);
    if (!result.ok) return result;
    this.patch(id, (r) =>
      r.lastRun === null
        ? r
        : { ...r, lastRun: { ...r.lastRun, restoredAt: this.clock().getTime() } },
    );
    return { ok: true };
  }

  /** A vault file/folder was renamed/moved — repoint fixed note targets and
   * last-run restore paths (mirrors DelegationManager.renameSource). */
  renameTarget(from: string, to: string): void {
    let changed = false;
    this.store.update((all) =>
      all.map((r) => {
        let next = r;
        if (next.target.kind === "note") {
          const moved = remapVaultPath(next.target.path, from, to);
          if (moved !== next.target.path) {
            next = { ...next, target: { kind: "note", path: moved } };
          }
        }
        if (next.lastRun !== null) {
          const moved = remapVaultPath(next.lastRun.path, from, to);
          if (moved !== next.lastRun.path) {
            next = { ...next, lastRun: { ...next.lastRun, path: moved } };
          }
        }
        if (next !== r) changed = true;
        return next;
      }),
    );
    if (changed) this.notify();
  }

  /** Clear `hasSnapshot` on last-runs whose bytes a retention sweep pruned —
   * fed by the composition root's single store sweep (see DelegationManager.
   * applyPrunedSnapshots). */
  applyPrunedSnapshots(ids: string[]): void {
    const pruned = new Set(ids);
    if (pruned.size === 0) return;
    let changed = false;
    this.store.update((all) =>
      all.map((r) => {
        if (r.lastRun === null || !r.lastRun.hasSnapshot || !pruned.has(r.lastRun.runId)) return r;
        changed = true;
        return { ...r, lastRun: { ...r.lastRun, hasSnapshot: false } };
      }),
    );
    if (changed) this.notify();
  }

  // -------------------------------------------------------------------------
  // Scheduler + runner internals
  // -------------------------------------------------------------------------

  /** One scheduler tick: queue every due routine, then pump. Called by the
   * boot interval and immediately from setRunner (launch catch-up). Exposed
   * for tests — driving ticks by hand beats faking interval timers. */
  tick(): void {
    // No provider → don't consume slots; the due comparison keeps them
    // pending "for free" and a later tick (provider connected) fires ONCE.
    if (this.getAgent === null || !this.isProviderConnected()) return;
    const now = this.clock();
    for (const routine of this.store.read()) {
      if (this.runningId === routine.id || this.pending.some((p) => p.id === routine.id)) continue;
      if (isRoutineDue(routine, now)) this.pending.push({ id: routine.id, manual: false });
    }
    void this.processNext();
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.processNext();
    }, BUSY_RETRY_MS);
  }

  /** Run the oldest queued routine if the shared background session is free.
   * Re-entrant-safe via `runningId`; re-invokes itself after each run. */
  private async processNext(): Promise<void> {
    if (this.runningId !== null) return;
    const agent = this.getAgent?.();
    if (!agent) return;
    if (this.pending.length === 0) return;
    if (agent.getState().status === "busy") {
      this.scheduleRetry();
      return;
    }
    const next = this.pending[0];
    if (!next) return;
    const routine = this.store.read().find((r) => r.id === next.id);
    if (!routine || (!next.manual && !routine.enabled)) {
      // Deleted or disabled while queued — drop and keep pumping.
      this.pending = this.pending.filter((p) => p !== next);
      void this.processNext();
      return;
    }
    // Serialize against delegation on the shared session (see the header).
    const token = this.turnLock.tryAcquire("routine");
    if (token === null) {
      this.scheduleRetry();
      return;
    }
    this.pending = this.pending.filter((p) => p !== next);
    this.runningId = routine.id;
    this.heldToken = token;
    const epoch = this.runEpoch;
    try {
      await this.run(agent, routine, epoch);
    } catch (err) {
      console.error("[routines] run failed:", err);
    } finally {
      this.turnLock.release(token);
      if (this.heldToken === token) this.heldToken = null;
      if (epoch === this.runEpoch) {
        this.runningId = null;
        try {
          this.onRunSettled?.();
        } catch (err) {
          console.warn("[routines] run-settled refresh failed:", err);
        }
        this.notify();
        void this.processNext();
      }
    }
  }

  private async run(agent: DelegationAgent, routine: Routine, epoch: number): Promise<void> {
    const startedAt = this.clock().getTime();
    // Stamp lastRunAt at DISPATCH: the slot is consumed even if the run fails
    // (no per-minute retry storm on a permanently failing routine) or the app
    // crashes mid-run (no double-fire on relaunch).
    this.patch(routine.id, (r) => ({ ...r, lastRunAt: startedAt }));
    this.notify();

    const runId = crypto.randomUUID();
    const now = this.clock();
    const path = routine.target.kind === "daily" ? this.dailyPath(now) : routine.target.path;

    const fail = (error: string, hasSnapshot: boolean): void => {
      this.recordOutcome(routine.id, epoch, {
        status: "failed",
        runId,
        path,
        startedAt,
        finishedAt: this.clock().getTime(),
        error,
        hasSnapshot,
        restoredAt: null,
      });
    };

    // Resolve the target's current bytes. Absent is fine (a daily note before
    // its first write — the append creates it); any other read failure fails
    // the run.
    let content: string | null;
    try {
      content = this.readVault(path);
    } catch (err) {
      if (!isEnoent(err)) {
        fail(`Couldn't read ${path}: ${toErrorMessage(err)}`, false);
        return;
      }
      content = null;
    }
    // Private notes never reach the background agent — same fail-closed rule
    // as delegation (unreadable frontmatter counts as private).
    if (content !== null && notePrivacy(content) !== "public") {
      fail(PRIVATE_TARGET_ERROR, false);
      return;
    }

    // Snapshot BEFORE the agent is dispatched — an unprompted run with no
    // undo point must never happen. A capture failure aborts the run.
    try {
      this.restore.capture({ origin: "routine", id: runId, path, content });
    } catch (err) {
      fail(`Couldn't snapshot ${path} before running: ${toErrorMessage(err)}`, false);
      return;
    }

    const result = await runTextTurn(agent, buildRoutinePrompt(routine, path, now), {
      timeoutMs: RUN_TIMEOUT_MS,
    });
    if (!result.ok) {
      fail(result.kind === "timeout" ? "Timed out" : result.error, true);
      return;
    }
    const text = result.text.trim();
    if (text.length === 0) {
      fail("The agent returned no output.", true);
      return;
    }

    // The run was abandoned mid-turn (stop() on logout/reset/vault-switch/quit
    // bumped the epoch and released the lock): DO NOT write. Writing here would
    // append bytes the UI can't undo (recordOutcome below no-ops on a stale
    // epoch, so lastRun stays null and its snapshot is unreachable), and on a
    // vault-switch the append could land in the newly-mounted vault. Bail
    // before touching the vault — the abandoned run leaves only an orphan
    // snapshot, which the newest-N prune reclaims.
    if (epoch !== this.runEpoch) return;

    // APPEND host-side, against the target's bytes as they are NOW (the user
    // may have edited during the run — never clobber, only append).
    let current: string | null;
    try {
      current = this.readVault(path);
    } catch (err) {
      if (!isEnoent(err)) {
        fail(`Couldn't append to ${path}: ${toErrorMessage(err)}`, true);
        return;
      }
      current = null;
    }
    // The note may have turned private mid-run — don't write into it.
    if (current !== null && notePrivacy(current) !== "public") {
      fail(PRIVATE_TARGET_ERROR, true);
      return;
    }
    const block = `## ${headerSafe(routine.name)} — ${formatIsoDate(now)}\n\n${text}\n`;
    try {
      this.writeVault(path, appendBlock(current, block));
    } catch (err) {
      fail(`Couldn't append to ${path}: ${toErrorMessage(err)}`, true);
      return;
    }

    this.recordOutcome(routine.id, epoch, {
      status: "done",
      runId,
      path,
      startedAt,
      finishedAt: this.clock().getTime(),
      summary: text.slice(0, SUMMARY_LEN),
      hasSnapshot: true,
      restoredAt: null,
    });
  }

  /** Write a terminal outcome onto the routine (no-op if it was deleted
   * mid-run) and notify. Epoch-guarded: a run abandoned by stop() settles
   * late — it must not overwrite state recorded after the teardown. */
  private recordOutcome(id: string, epoch: number, lastRun: RoutineLastRun): void {
    if (epoch !== this.runEpoch) return;
    this.patch(id, (r) => ({ ...r, lastRun }));
    this.notify();
  }

  private patch(id: string, transform: (r: Routine) => Routine): void {
    this.store.update((all) => all.map((r) => (r.id === id ? transform(r) : r)));
  }

  private notify(): void {
    try {
      this.onChanged?.(this.list());
    } catch (err) {
      console.warn("[routines] change notification failed:", err);
    }
  }
}

/** Routine names are single-line UI strings; keep the appended header safe
 * even if one somehow carries a newline. */
function headerSafe(name: string): string {
  return name.replaceAll(/\s+/g, " ").trim();
}

/** Append `block` after the existing content with exactly one blank line
 * between — without trimming a byte of what's there. */
function appendBlock(current: string | null, block: string): string {
  if (current === null || current === "") return block;
  if (current.endsWith("\n\n")) return current + block;
  if (current.endsWith("\n")) return `${current}\n${block}`;
  return `${current}\n\n${block}`;
}

/** The instruction the background agent runs. The write path is host-owned:
 * the agent REPLIES with the block; the host appends it. */
function buildRoutinePrompt(routine: Routine, targetPath: string, now: Date): string {
  return [
    `You are running the scheduled routine "${headerSafe(routine.name)}" (today is ${formatIsoDate(now)}).`,
    ``,
    `Instruction:`,
    routine.prompt,
    ``,
    `The result will be appended by the app to ./vault/${targetPath} — you may read that note (and search the vault) for context.`,
    `Rules:`,
    `- Reply with ONLY the markdown to append: no preamble, no code fence around the whole reply, no heading for the routine itself (the app adds one).`,
    `- Do NOT create or edit any files. The app writes your reply for you; any edit you make yourself cannot be undone by the user.`,
    `- If you cannot complete the instruction, reply with a one-line note saying why.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors the delegation manager.
// ---------------------------------------------------------------------------

let instance: RoutinesManager | null = null;

export function getRoutinesManager(): RoutinesManager {
  if (!instance) {
    instance = new RoutinesManager({
      onChanged: (result) => emitEvent("onRoutinesUpdated", result),
      onRunSettled: () => getVaultManager().refresh(),
      // Shared with the delegation manager: one turn at a time on the shared
      // background session, across both surfaces.
      turnLock: getBackgroundTurnLock(),
    });
  }
  return instance;
}

export function resetRoutinesManager(): void {
  instance?.stop();
  instance = null;
}
