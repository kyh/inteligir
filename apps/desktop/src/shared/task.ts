import { z } from "zod";

// ---------------------------------------------------------------------------
// Task schedule schemas — discriminated union
// ---------------------------------------------------------------------------

const CronScheduleSchema = z.object({
  type: z.literal("cron"),
  cron: z.string(),
});

const IntervalScheduleSchema = z.object({
  type: z.literal("interval"),
  intervalMs: z.number().int().positive(),
});

const OnceScheduleSchema = z.object({
  type: z.literal("once"),
  runAt: z.number(),
});

export const TaskScheduleSchema = z.discriminatedUnion("type", [
  CronScheduleSchema,
  IntervalScheduleSchema,
  OnceScheduleSchema,
]);

export type TaskSchedule = z.infer<typeof TaskScheduleSchema>;

// ---------------------------------------------------------------------------
// Task schema
// ---------------------------------------------------------------------------

const TaskSchema = z.object({
  id: z.string(),
  label: z.string(),
  prompt: z.string(),
  schedule: TaskScheduleSchema,
  enabled: z.boolean(),
  lastRunAt: z.number().nullable(),
  createdAt: z.number(),
});

export type Task = z.infer<typeof TaskSchema>;

export const TasksFileSchema = z.object({
  tasks: z.array(TaskSchema),
});

// ---------------------------------------------------------------------------
// Task run log — per-execution tracking
// ---------------------------------------------------------------------------

export const TaskRunLogSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  startedAt: z.number(),
  durationMs: z.number().nullable(),
  status: z.enum(["running", "completed", "failed"]),
  error: z.string().nullable(),
  resultSummary: z.string().nullable(),
});

export type TaskRunLog = z.infer<typeof TaskRunLogSchema>;

// ---------------------------------------------------------------------------
// Method params & results
// ---------------------------------------------------------------------------

export const CreateTaskParamsSchema = z.object({
  label: z.string().min(1),
  prompt: z.string().min(1),
  schedule: TaskScheduleSchema,
});

export type CreateTaskParams = z.infer<typeof CreateTaskParamsSchema>;
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
