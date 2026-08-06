// ---------------------------------------------------------------------------
// Scheduled routines — delegation's sibling, on the same background lane and
// the same durable lock (./background-runs).
//
// THE SCHEDULER IS AN ALARM, not an interval, and that is the one thing this
// host does strictly better than the desktop. There, a `setInterval` asked
// every minute whether anything was due, which meant a laptop asleep at 09:00
// simply missed the slot until it woke. A Durable Object can be woken AT an
// instant, so the routine's next slot is computed (`nextRoutineDueAt`) and
// folded into the object's ONE alarm — the object sleeps until then, costs
// nothing in between, and fires on time.
//
// (The desktop's manager also calls `this.schedulerTimer.unref()`
// unconditionally. Workers' `setInterval` answers a number, so a direct port
// would throw on the first wiring. It is not carried over because the whole
// timer is not carried over.)
//
// THE RISK SHAPE DIFFERS FROM DELEGATION ON PURPOSE, and the code leans on it.
// Nobody is watching when a routine fires, so:
//
//   • THE WRITE PATH IS HOST-OWNED. The agent is asked to REPLY with markdown,
//     and the host appends that reply to the target note. Combined with the
//     pre-run snapshot, the worst an unattended run can do to its target is an
//     appended block the user can restore away.
//   • AN EPOCH GUARD BAILS MID-RUN. The routine's config carries a counter that
//     every edit bumps; the run records the counter it started under, and a
//     settle that finds a different one — or no routine at all — writes
//     NOTHING. Disabling or deleting a routine while its turn is in flight is
//     the case this exists for, and the durable counter is what makes it
//     survive the eviction between dispatch and settle.
//
// `lastRunAt` is stamped at DISPATCH, so a run the object never saw finish
// consumes its slot rather than re-firing every wake — which is also what makes
// the alarm handler IDEMPOTENT under Cloudflare's at-least-once retries.
// ---------------------------------------------------------------------------

import { formatIsoDate } from "@repo/notes/daily-path";
import type { RestoreSnapshotResult } from "@repo/bridge/delegation";
import { isRoutineDue, nextRoutineDueAt } from "@repo/bridge/routine-schedule";
import {
  RoutineSchema,
  type ListRoutinesResult,
  type Routine,
  type RoutineLastRun,
  type RunRoutineNowResult,
  type UpsertRoutineParams,
  type UpsertRoutineResult,
} from "@repo/bridge/routines";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import { Value } from "@sinclair/typebox/value";

import type { AgentSnapshots } from "../agent/agent-snapshots";
import type {
  BackgroundDispatch,
  BackgroundOutcome,
  BackgroundRun,
  BackgroundRuns,
} from "./background-runs";

const MAX_ROUTINES = 50;
const SUMMARY_LEN = 200;

/** How long to wait before looking again when a slot has already passed and the
 * tick could not act on it (no provider connected, or the lane is busy). The
 * ONLY polling left in the scheduler, and it exists to stop the alarm being
 * armed in the past — which would wake the object in a tight loop. */
const SCHEDULER_RETRY_MS = 60 * 1000;

type RoutineRow = {
  readonly id: string;
  readonly epoch: number;
  readonly queued_at: number | null;
  readonly queued_manual: number;
  readonly in_flight: string | null;
  readonly last_snapshot_id: string | null;
  readonly record: string;
};

/**
 * What a dispatched run carries until it settles.
 *
 * Durable, and every field is here because the settle happens in a LATER
 * invocation than the dispatch: the resolved target (a daily target resolves
 * per run day), the restore point it captured, the epoch it started under, and
 * when it started.
 */
type InFlight = {
  readonly turnId: string;
  readonly epoch: number;
  readonly path: string;
  readonly snapshotId: string;
  readonly startedAt: number;
};

/** The vault reads and the ONE write a routine run needs. Structural so the
 * tests drive the real manager over the object's real vault. */
type RoutineVault = {
  /** A live note's text, or null when there is none — a daily note before its
   * first write is the ordinary case, not an error. */
  readOptional(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<{ readonly ok: boolean }>;
};

export type RoutinesDeps = {
  readonly sql: SqlStorage;
  readonly vault: RoutineVault;
  readonly snapshots: AgentSnapshots;
  readonly runs: BackgroundRuns;
  readonly dispatch: BackgroundDispatch;
  /** TODAY's daily-note path, resolved from Settings → Notes. */
  readonly dailyPath: (now: Date) => string;
  /** Injected clock — every due decision and timestamp reads it. */
  readonly clock: () => Date;
  /** Why a run cannot be attempted at all right now, or null. */
  readonly refusalReason: () => string | null;
  readonly onChanged: (result: ListRoutinesResult) => void;
  /** The schedule moved: the host must re-derive its alarm. */
  readonly onScheduleChanged: () => void;
};

export class Routines {
  private readonly deps: RoutinesDeps;

  constructor(deps: RoutinesDeps) {
    this.deps = deps;
    deps.sql.exec(
      `CREATE TABLE IF NOT EXISTS agent_routines (
         id TEXT PRIMARY KEY,
         created_at INTEGER NOT NULL,
         epoch INTEGER NOT NULL,
         queued_at INTEGER,
         queued_manual INTEGER NOT NULL,
         in_flight TEXT,
         last_snapshot_id TEXT,
         record TEXT NOT NULL
       )`,
    );
  }

  // ---- reads ---------------------------------------------------------------

  list(): ListRoutinesResult {
    const run = this.deps.runs.holder();
    return {
      routines: this.rows().map((row) => this.toRoutine(row)),
      runningId: run !== null && run.owner === "routine" ? run.ref : null,
    };
  }

  /**
   * When this host must wake for a routine, or null.
   *
   * The earliest slot across the enabled routines. Only ever a SCHEDULING
   * hint: `tick` still decides with `isRoutineDue`, so an alarm that fires
   * early, late, or twice cannot make a routine run at the wrong moment.
   */
  nextDueAt(now: number): number | null {
    const due: number[] = [];
    for (const row of this.rows()) {
      const at = nextRoutineDueAt(this.toRoutine(row));
      if (at !== null) due.push(at.getTime());
    }
    if (due.length === 0) return null;
    const earliest = Math.min(...due);
    return earliest > now ? earliest : now + SCHEDULER_RETRY_MS;
  }

  // ---- config --------------------------------------------------------------

  /** Create (no id) or edit (with id) a routine's config. Run bookkeeping is
   * host-owned and preserved across edits; a new routine's `createdAt` floor is
   * NOW, so slots that passed before it existed never fire. */
  upsert(params: UpsertRoutineParams): UpsertRoutineResult {
    const now = this.deps.clock().getTime();
    if (params.id === undefined) {
      if (this.rows().length >= MAX_ROUTINES) {
        return { ok: false, error: `Routine limit reached (${MAX_ROUTINES}).` };
      }
      const routine: Routine = {
        id: crypto.randomUUID(),
        name: params.name,
        prompt: params.prompt,
        schedule: params.schedule,
        target: params.target,
        enabled: params.enabled,
        createdAt: now,
        lastRunAt: null,
        lastRun: null,
      };
      this.deps.sql.exec(
        `INSERT INTO agent_routines
           (id, created_at, epoch, queued_at, queued_manual, in_flight, last_snapshot_id, record)
         VALUES (?, ?, 1, NULL, 0, NULL, NULL, ?)`,
        routine.id,
        routine.createdAt,
        JSON.stringify(routine),
      );
      this.settled();
      return { ok: true, routine };
    }
    const row = this.rowAt(params.id);
    if (row === null) return { ok: false, error: "Unknown routine." };
    const updated: Routine = {
      ...this.toRoutine(row),
      name: params.name,
      prompt: params.prompt,
      schedule: params.schedule,
      target: params.target,
      enabled: params.enabled,
    };
    // The epoch moves on every CONFIG change — never on run bookkeeping, which
    // the run itself writes. That is what makes "disabled while the turn was in
    // flight" a mismatch the settle can see.
    this.deps.sql.exec(
      "UPDATE agent_routines SET epoch = epoch + 1, record = ? WHERE id = ?",
      JSON.stringify(updated),
      updated.id,
    );
    this.settled();
    return { ok: true, routine: updated };
  }

  /** Delete a routine. An in-flight run of it settles against nothing — the
   * epoch guard's other half. */
  delete(id: string): { ok: boolean } {
    if (this.rowAt(id) === null) return { ok: false };
    this.deps.sql.exec("DELETE FROM agent_routines WHERE id = ?", id);
    this.settled();
    return { ok: true };
  }

  /** Queue an immediate run — the "Run now" affordance, which works on a
   * disabled routine too, that being how a user tests a config. */
  async runNow(id: string): Promise<RunRoutineNowResult> {
    const refusal = this.deps.refusalReason();
    if (refusal !== null) return { ok: false, error: refusal };
    const row = this.rowAt(id);
    if (row === null) return { ok: false, error: "Unknown routine." };
    if (row.in_flight !== null || row.queued_at !== null) {
      return { ok: false, error: "This routine is already running." };
    }
    this.enqueue(id, true);
    this.notify();
    await this.pump();
    return { ok: true };
  }

  /** Put the target note back to the bytes captured before the LAST run. */
  async restoreLastRun(id: string): Promise<RestoreSnapshotResult> {
    const row = this.rowAt(id);
    if (row === null) return { ok: false, error: "Unknown routine." };
    if (row.in_flight !== null || row.queued_at !== null) {
      return { ok: false, error: "Wait for the routine to finish before restoring." };
    }
    if (row.last_snapshot_id === null || !this.deps.snapshots.holds(row.last_snapshot_id)) {
      return { ok: false, error: "No saved copy exists for this routine's last run." };
    }
    const restored = await this.deps.snapshots.restore([row.last_snapshot_id], "routine");
    if (!restored.ok) return { ok: false, error: restored.reason };
    this.patch(id, (routine) =>
      routine.lastRun === null
        ? routine
        : { ...routine, lastRun: { ...routine.lastRun, restoredAt: this.deps.clock().getTime() } },
    );
    this.notify();
    return { ok: true };
  }

  // ---- the scheduler -------------------------------------------------------

  /**
   * One scheduler pass: queue every routine whose slot has passed, then pump.
   *
   * IDEMPOTENT, which the alarm's at-least-once delivery requires: `lastRunAt`
   * is stamped at dispatch, so a retried alarm finds the same routine no longer
   * due, and a routine already queued or in flight is skipped outright.
   */
  async tick(): Promise<void> {
    // No provider → do not consume slots. The due comparison keeps them pending
    // for free, and the first tick after a provider is connected fires ONCE.
    if (this.deps.refusalReason() !== null) return;
    const now = this.deps.clock();
    let queued = false;
    for (const row of this.rows()) {
      if (row.in_flight !== null || row.queued_at !== null) continue;
      if (!isRoutineDue(this.toRoutine(row), now)) continue;
      this.enqueue(row.id, false);
      queued = true;
    }
    if (queued) this.notify();
    await this.pump();
  }

  /** Run the oldest queued routine if the background lane is free. */
  async pump(): Promise<void> {
    for (;;) {
      const next = this.deps.sql
        .exec<RoutineRow>(
          `SELECT id, epoch, queued_at, queued_manual, in_flight, last_snapshot_id, record
           FROM agent_routines WHERE queued_at IS NOT NULL AND in_flight IS NULL
           ORDER BY queued_at, id LIMIT 1`,
        )
        .toArray()[0];
      if (next === undefined) return;
      const routine = this.toRoutine(next);
      if (next.queued_manual === 0 && !routine.enabled) {
        // Disabled while it sat queued — drop it and keep pumping.
        this.dequeue(next.id);
        continue;
      }

      const startedAt = this.deps.clock().getTime();
      const path =
        routine.target.kind === "daily"
          ? this.deps.dailyPath(this.deps.clock())
          : routine.target.path;

      // The in-flight row is written INSIDE prepare, where the run id exists:
      // the dispatch is the only thing that knows it, and holding it in a
      // closure variable would mean the settle in a later invocation had
      // nothing durable to read.
      const outcome = await this.deps.dispatch("routine", next.id, async (run) => {
        // Fail-closed, and BEFORE the agent sees anything: an unattended run
        // with no undo point must never happen.
        const snapshotId = await this.deps.snapshots.capture(
          { origin: "routine", ref: next.id },
          path,
        );
        if (snapshotId === null) {
          return { ok: false, error: `Couldn't save a restore point for ${path}.` };
        }
        const flight: InFlight = {
          turnId: run.turnId,
          epoch: next.epoch,
          path,
          snapshotId,
          startedAt,
        };
        this.deps.sql.exec(
          "UPDATE agent_routines SET in_flight = ? WHERE id = ?",
          JSON.stringify(flight),
          next.id,
        );
        return { ok: true, prompt: buildRoutinePrompt(routine, path, this.deps.clock()) };
      });

      if (!outcome.ok && outcome.reason === "busy") return;
      this.dequeue(next.id);
      // The slot is consumed either way (see the header): a routine that fails
      // every run must not retry on every tick.
      this.stampDispatch(next.id, startedAt);
      if (!outcome.ok) {
        const flight = readInFlight(this.rowAt(next.id)?.in_flight ?? null);
        this.deps.sql.exec("UPDATE agent_routines SET in_flight = NULL WHERE id = ?", next.id);
        this.recordOutcome(
          next.id,
          next.epoch,
          {
            status: "failed",
            runId: crypto.randomUUID(),
            path,
            startedAt,
            finishedAt: this.deps.clock().getTime(),
            error: outcome.error,
            hasSnapshot: flight !== null,
            restoredAt: null,
          },
          flight?.snapshotId ?? null,
        );
        this.notify();
        continue;
      }
      this.notify();
      return;
    }
  }

  /**
   * Record how a run ended, and — when it succeeded — APPEND its reply to the
   * target note.
   *
   * The append reads the target's bytes as they are NOW rather than as the run
   * saw them: the user may have edited during the ten minutes it took, and a
   * scheduled write must never clobber that.
   */
  async settle(run: BackgroundRun, outcome: BackgroundOutcome): Promise<void> {
    const row = this.rowAt(run.ref);
    // Deleted mid-flight: there is nothing to write to and nothing to record.
    if (row === null) return;
    const flight = readInFlight(row.in_flight);
    if (flight === null || flight.turnId !== run.turnId) return;
    this.deps.sql.exec("UPDATE agent_routines SET in_flight = NULL WHERE id = ?", run.ref);

    // The epoch guard. A routine disabled or edited while its turn was in
    // flight must not have an unattended reply appended to a note under a
    // config the user has since changed.
    if (row.epoch !== flight.epoch) {
      this.notify();
      return;
    }

    const finish = (last: RoutineLastRun): void => {
      this.recordOutcome(run.ref, flight.epoch, last, flight.snapshotId);
      this.notify();
    };
    const failed = (error: string): void =>
      finish({
        status: "failed",
        runId: run.turnId,
        path: flight.path,
        startedAt: flight.startedAt,
        finishedAt: this.deps.clock().getTime(),
        error,
        hasSnapshot: true,
        restoredAt: null,
      });

    if (outcome.kind !== "done") {
      failed(outcome.kind === "stopped" ? "Stopped." : outcome.error);
      return;
    }
    const text = outcome.text.trim();
    if (text === "") {
      failed("The agent returned no output.");
      return;
    }

    const routine = this.toRoutine(row);
    const block = `## ${headerSafe(routine.name)} — ${formatIsoDate(this.deps.clock())}\n\n${text}\n`;
    let current: string | null;
    try {
      current = await this.deps.vault.readOptional(flight.path);
    } catch (error) {
      failed(`Couldn't append to ${flight.path}: ${toErrorMessage(error)}`);
      return;
    }
    const written = await this.deps.vault.writeText(flight.path, appendBlock(current, block));
    if (!written.ok) {
      failed(`Couldn't append to ${flight.path}.`);
      return;
    }
    finish({
      status: "done",
      runId: run.turnId,
      path: flight.path,
      startedAt: flight.startedAt,
      finishedAt: this.deps.clock().getTime(),
      summary: text.slice(0, SUMMARY_LEN),
      hasSnapshot: true,
      restoredAt: null,
    });
  }

  // ---- internals -----------------------------------------------------------

  private rows(): RoutineRow[] {
    return this.deps.sql
      .exec<RoutineRow>(
        `SELECT id, epoch, queued_at, queued_manual, in_flight, last_snapshot_id, record
         FROM agent_routines ORDER BY created_at, id`,
      )
      .toArray();
  }

  private rowAt(id: string): RoutineRow | null {
    return (
      this.deps.sql
        .exec<RoutineRow>(
          `SELECT id, epoch, queued_at, queued_manual, in_flight, last_snapshot_id, record
           FROM agent_routines WHERE id = ?`,
          id,
        )
        .toArray()[0] ?? null
    );
  }

  /** The record as the wire declares it, with `hasSnapshot` resolved against
   * the store rather than stored (see Delegations.toDelegation). */
  private toRoutine(row: RoutineRow): Routine {
    const parsed: unknown = JSON.parse(row.record);
    if (!Value.Check(RoutineSchema, parsed)) return unreadable(row);
    if (parsed.lastRun === null) return parsed;
    const held = row.last_snapshot_id !== null && this.deps.snapshots.holds(row.last_snapshot_id);
    return { ...parsed, lastRun: { ...parsed.lastRun, hasSnapshot: held } };
  }

  private patch(id: string, transform: (routine: Routine) => Routine): void {
    const row = this.rowAt(id);
    if (row === null) return;
    this.deps.sql.exec(
      "UPDATE agent_routines SET record = ? WHERE id = ?",
      JSON.stringify(transform(this.toRoutine(row))),
      id,
    );
  }

  private enqueue(id: string, manual: boolean): void {
    this.deps.sql.exec(
      "UPDATE agent_routines SET queued_at = ?, queued_manual = ? WHERE id = ?",
      this.deps.clock().getTime(),
      manual ? 1 : 0,
      id,
    );
  }

  private dequeue(id: string): void {
    this.deps.sql.exec(
      "UPDATE agent_routines SET queued_at = NULL, queued_manual = 0 WHERE id = ?",
      id,
    );
  }

  /** Consume the slot. Stamped at dispatch so a crash mid-run skips to the next
   * one rather than re-firing on the next wake. */
  private stampDispatch(id: string, at: number): void {
    this.patch(id, (routine) => ({ ...routine, lastRunAt: at }));
  }

  /** Write a terminal outcome, unless the epoch moved under it. `snapshotId`
   * is the restore point THIS run captured — what "Restore last run" reads
   * back. */
  private recordOutcome(
    id: string,
    epoch: number,
    lastRun: RoutineLastRun,
    snapshotId: string | null,
  ): void {
    const row = this.rowAt(id);
    if (row === null || row.epoch !== epoch) return;
    this.deps.sql.exec(
      "UPDATE agent_routines SET last_snapshot_id = ? WHERE id = ?",
      snapshotId,
      id,
    );
    this.patch(id, (routine) => ({ ...routine, lastRun }));
  }

  private notify(): void {
    this.deps.onChanged(this.list());
  }

  /** A config change moved the schedule: announce it AND let the host re-derive
   * its alarm, since the next wake may now be sooner. */
  private settled(): void {
    this.notify();
    this.deps.onScheduleChanged();
  }
}

/** The projection of a record this build cannot read (see Delegations). */
function unreadable(row: RoutineRow): Routine {
  return {
    id: row.id,
    name: "Unreadable routine",
    prompt: "This routine was recorded in a format this version cannot read.",
    schedule: { cadence: "daily", timeOfDay: "09:00" },
    target: { kind: "daily" },
    enabled: false,
    createdAt: 0,
    lastRunAt: null,
    lastRun: null,
  };
}

function readInFlight(value: string | null): InFlight | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null) return null;
  const record: Record<string, unknown> = { ...parsed };
  const turnId = record["turnId"];
  const epoch = record["epoch"];
  const path = record["path"];
  const snapshotId = record["snapshotId"];
  const startedAt = record["startedAt"];
  if (typeof turnId !== "string" || typeof epoch !== "number") return null;
  if (typeof path !== "string" || typeof snapshotId !== "string") return null;
  if (typeof startedAt !== "number") return null;
  return { turnId, epoch, path, snapshotId, startedAt };
}

/** Routine names are single-line UI strings; keep the appended header safe even
 * if one somehow carries a newline. */
function headerSafe(name: string): string {
  return name.replaceAll(/\s+/g, " ").trim();
}

/** Append `block` after the existing content with exactly one blank line
 * between — without trimming a byte of what is there. */
function appendBlock(current: string | null, block: string): string {
  if (current === null || current === "") return block;
  if (current.endsWith("\n\n")) return current + block;
  if (current.endsWith("\n")) return `${current}\n${block}`;
  return `${current}\n\n${block}`;
}

/** The instruction the background agent runs. The write path is host-owned: the
 * agent REPLIES with the block, the host appends it. */
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
    `- Do NOT create or edit any files. The app writes your reply for you.`,
    `- If you cannot complete the instruction, reply with a one-line note saying why.`,
  ].join("\n");
}
