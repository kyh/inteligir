import { type Static, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Routine — a scheduled agent task: a prompt the background agent runs
// UNPROMPTED on a cadence (daily/weekly/monthly at a local time of day), whose
// result the HOST appends to a target note (today's daily note or a named
// note). The sibling of delegation: same background pi session, same
// serialized one-turn-at-a-time queue, same pre-run snapshot undo — but where
// a delegation is a one-shot record, a routine is durable config that fires
// once per scheduled slot.
//
// Deliberately NOT cron: cadence + "HH:MM" (+ a day picker where the cadence
// needs one) is the whole schedule language. The due computation over it is
// pure (routine-schedule.ts) and tested as a pure function.
// ---------------------------------------------------------------------------

/** Local time of day, 24h "HH:MM". The pattern is the wire guard; the pure
 * parser (routine-schedule.ts) re-validates fail-safe (invalid → never due). */
const TimeOfDaySchema = Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" });

// Cadence-correlated fields are typed per variant (a daily schedule with a
// dayOfMonth cannot be constructed). dayOfMonth is capped at 28 so a monthly
// slot exists in EVERY month — no silent Feb-skips-the-run surprise.
export const RoutineScheduleSchema = Type.Union([
  Type.Object(
    { cadence: Type.Literal("daily"), timeOfDay: TimeOfDaySchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      cadence: Type.Literal("weekly"),
      timeOfDay: TimeOfDaySchema,
      /** 0 = Sunday … 6 = Saturday (Date.getDay()). */
      dayOfWeek: Type.Integer({ minimum: 0, maximum: 6 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      cadence: Type.Literal("monthly"),
      timeOfDay: TimeOfDaySchema,
      /** 1–28 so the slot exists in every month. */
      dayOfMonth: Type.Integer({ minimum: 1, maximum: 28 }),
    },
    { additionalProperties: false },
  ),
]);

export type RoutineSchedule = Static<typeof RoutineScheduleSchema>;

/** Where the run's result lands. `daily` = TODAY's daily note (resolved
 * host-side from the Settings → Notes folder/format at run time); `note` = a
 * fixed vault-relative path. */
export const RoutineTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal("daily") }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal("note"), path: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
]);

export type RoutineTarget = Static<typeof RoutineTargetSchema>;

/** Fields every terminal run outcome carries. `path` is the RESOLVED target
 * the run wrote/read (a daily target resolves per run day), which is also the
 * restore target for the pre-run snapshot; `runId` keys that snapshot in the
 * shared SnapshotStore. */
const lastRunBaseFields = {
  runId: Type.String(),
  /** Resolved target path at run time (remapped across vault renames). */
  path: Type.String(),
  startedAt: Type.Number(),
  finishedAt: Type.Number(),
  /** True while the host still holds the target's pre-run bytes — the
   * "Restore" affordance in Settings (prune clears it). */
  hasSnapshot: Type.Boolean(),
  /** When the user last restored this run's snapshot (null = never). */
  restoredAt: Type.Union([Type.Number(), Type.Null()]),
};

// Terminal-only by construction: "running" is deliberately NOT a persisted
// state (ListRoutinesResult.runningId is in-memory), so a crash mid-run can
// never leave a routine wedged "running" on disk.
export const RoutineLastRunSchema = Type.Union([
  Type.Object(
    { ...lastRunBaseFields, status: Type.Literal("done"), summary: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...lastRunBaseFields, status: Type.Literal("failed"), error: Type.String() },
    { additionalProperties: false },
  ),
]);

export type RoutineLastRun = Static<typeof RoutineLastRunSchema>;

export const RoutineSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String({ minLength: 1 }),
    /** The instruction the background agent runs each slot. */
    prompt: Type.String({ minLength: 1 }),
    schedule: RoutineScheduleSchema,
    target: RoutineTargetSchema,
    enabled: Type.Boolean(),
    /** Creation instant — the due floor: only slots AFTER this fire, so a
     * routine created at 3pm with a 9am slot doesn't run immediately. */
    createdAt: Type.Number(),
    /** When the last run DISPATCHED (stamped before the agent turn, so a
     * crash mid-run skips to the next slot instead of re-firing). Null =
     * never ran. */
    lastRunAt: Type.Union([Type.Number(), Type.Null()]),
    /** Last terminal outcome (null until a first run settles). */
    lastRun: Type.Union([RoutineLastRunSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type Routine = Static<typeof RoutineSchema>;

// ---------------------------------------------------------------------------
// IPC params/results
// ---------------------------------------------------------------------------

/** Create (no `id`) or edit (with `id`) a routine's CONFIG. The run
 * bookkeeping (createdAt, lastRunAt, lastRun) is host-owned and preserved
 * across edits — the wire shape can't even express it. */
export const UpsertRoutineParamsSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    schedule: RoutineScheduleSchema,
    target: RoutineTargetSchema,
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type UpsertRoutineParams = Static<typeof UpsertRoutineParamsSchema>;

export type UpsertRoutineResult = { ok: true; routine: Routine } | { ok: false; error: string };

/** `runningId` is the routine currently on the background agent (at most one —
 * the queue is serialized with delegation), in-memory only. */
export type ListRoutinesResult = { routines: Routine[]; runningId: string | null };

export type RunRoutineNowResult = { ok: true } | { ok: false; error: string };
