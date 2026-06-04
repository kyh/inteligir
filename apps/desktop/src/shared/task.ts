import { type Static, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Task schedule schemas — discriminated union
// ---------------------------------------------------------------------------

const CronScheduleSchema = Type.Object(
  { type: Type.Literal("cron"), cron: Type.String() },
  { additionalProperties: false },
);

const IntervalScheduleSchema = Type.Object(
  { type: Type.Literal("interval"), intervalMs: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

const OnceScheduleSchema = Type.Object(
  { type: Type.Literal("once"), runAt: Type.Number() },
  { additionalProperties: false },
);

export const TaskScheduleSchema = Type.Union([
  CronScheduleSchema,
  IntervalScheduleSchema,
  OnceScheduleSchema,
]);

export type TaskSchedule = Static<typeof TaskScheduleSchema>;

// ---------------------------------------------------------------------------
// Task schema
// ---------------------------------------------------------------------------

export const TaskSchema = Type.Object(
  {
    id: Type.String(),
    label: Type.String(),
    prompt: Type.String(),
    schedule: TaskScheduleSchema,
    enabled: Type.Boolean(),
    lastRunAt: Type.Union([Type.Number(), Type.Null()]),
    createdAt: Type.Number(),
  },
  { additionalProperties: false },
);

export type Task = Static<typeof TaskSchema>;

// ---------------------------------------------------------------------------
// Task run log — per-execution tracking
// ---------------------------------------------------------------------------

export const TaskRunLogSchema = Type.Object(
  {
    id: Type.String(),
    taskId: Type.String(),
    startedAt: Type.Number(),
    durationMs: Type.Union([Type.Number(), Type.Null()]),
    status: Type.Union([
      Type.Literal("running"),
      Type.Literal("completed"),
      Type.Literal("failed"),
    ]),
    error: Type.Union([Type.String(), Type.Null()]),
    resultSummary: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export type TaskRunLog = Static<typeof TaskRunLogSchema>;

// ---------------------------------------------------------------------------
// Method params & results
// ---------------------------------------------------------------------------

export const CreateTaskParamsSchema = Type.Object(
  {
    label: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    schedule: TaskScheduleSchema,
  },
  { additionalProperties: false },
);

export type CreateTaskParams = Static<typeof CreateTaskParamsSchema>;
export type CreateTaskResult = { task: Task };

export type ListTasksResult = { tasks: Task[] };

export type DeleteTaskResult = { ok: true };

export type ToggleTaskResult = { task: Task };

// ---------------------------------------------------------------------------
// Display helpers (pure)
// ---------------------------------------------------------------------------

export function formatSchedule(schedule: TaskSchedule): string {
  switch (schedule.type) {
    case "cron":
      return humanizeCron(schedule.cron);
    case "interval": {
      const mins = Math.round(schedule.intervalMs / 60_000);
      if (mins < 60) return mins === 1 ? "every minute" : `every ${mins} minutes`;
      const hrs = Math.round(mins / 60);
      return hrs === 1 ? "every hour" : `every ${hrs} hours`;
    }
    case "once":
      return `once on ${new Date(schedule.runAt).toLocaleString()}`;
  }
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Cheap English-ifier for the cron expressions our presets generate. Falls
// back to the raw expression for shapes we don't cover.
function humanizeCron(cron: string): string {
  const [minute, hour, day, month, weekday] = cron.split(/\s+/);
  if (!minute || !hour || !day || !month || !weekday) return cron;
  if (day !== "*" || month !== "*") return cron;

  const minN = Number(minute);
  const hourN = Number(hour);
  if (Number.isNaN(minN) || Number.isNaN(hourN)) return cron;
  const time = `${hourN.toString().padStart(2, "0")}:${minN.toString().padStart(2, "0")}`;

  if (weekday === "*") return `every day at ${time}`;
  if (weekday === "1-5") return `every weekday at ${time}`;
  if (/^[0-6]$/.test(weekday)) {
    return `every ${DAY_NAMES[Number(weekday)]} at ${time}`;
  }
  return cron;
}
