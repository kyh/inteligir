import { z } from "zod";

// ---------------------------------------------------------------------------
// Task schedule schemas — discriminated union
// ---------------------------------------------------------------------------

export const CronScheduleSchema = z.object({
  type: z.literal("cron"),
  cron: z.string(),
});

export const IntervalScheduleSchema = z.object({
  type: z.literal("interval"),
  intervalMs: z.number().int().positive(),
});

export const OnceScheduleSchema = z.object({
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
});

export type Task = z.infer<typeof TaskSchema>;

export const TasksFileSchema = z.object({
  tasks: z.array(TaskSchema),
});

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
