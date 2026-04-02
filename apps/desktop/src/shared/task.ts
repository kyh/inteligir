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

export const TaskSchema = z.object({
  id: z.string(),
  label: z.string(),
  prompt: z.string(),
  schedule: TaskScheduleSchema,
  enabled: z.boolean(),
  lastRunAt: z.number().nullable(),
  createdAt: z.number(),
  /** System tasks (e.g. heartbeat) cannot be deleted by the user. */
  system: z.boolean().optional(),
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
      return `cron: ${schedule.cron}`;
    case "interval": {
      const mins = Math.round(schedule.intervalMs / 60_000);
      if (mins < 60) return `every ${mins}m`;
      const hrs = Math.round(mins / 60);
      return `every ${hrs}h`;
    }
    case "once":
      return `once: ${new Date(schedule.runAt).toLocaleString()}`;
  }
}
