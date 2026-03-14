import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

import { createTask, deleteTask, getTasks, toggleTask } from "../task-store";
import { TaskScheduleSchema, type TaskSchedule } from "../../shared/task";

// ---------------------------------------------------------------------------
// manage_tasks — agent tool for task CRUD
// ---------------------------------------------------------------------------

const manageTasksSchema = Type.Object({
  action: Type.Union([
    Type.Literal("create"),
    Type.Literal("list"),
    Type.Literal("toggle"),
    Type.Literal("delete"),
  ], { description: "Action to perform" }),
  label: Type.Optional(Type.String({ description: "Task label (required for create)" })),
  prompt: Type.Optional(Type.String({ description: "Prompt to run when task fires (required for create)" })),
  schedule: Type.Optional(Type.Unsafe<TaskSchedule>({
    description: "Schedule: {type:'cron',cron:string} | {type:'interval',intervalMs:number} | {type:'once',runAt:number}",
  })),
  taskId: Type.Optional(Type.String({ description: "Task ID (required for toggle/delete)" })),
});

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

export function createManageTasksTool(): AgentTool<typeof manageTasksSchema> {
  return {
    name: "manage_tasks",
    label: "manage_tasks",
    description:
      "Create, list, toggle, or delete scheduled tasks. " +
      "Tasks run automatically on a cron/interval/once schedule.",
    parameters: manageTasksSchema,
    execute: async (
      _toolCallId: string,
      params: {
        action: "create" | "list" | "toggle" | "delete";
        label?: string;
        prompt?: string;
        schedule?: TaskSchedule;
        taskId?: string;
      },
    ): Promise<AgentToolResult<undefined>> => {
      switch (params.action) {
        case "list": {
          const tasks = getTasks();
          if (tasks.length === 0) return textResult("No tasks configured.");
          const lines = tasks.map(
            (t) =>
              `- [${t.enabled ? "ON" : "OFF"}] ${t.label} (${t.id})\n  schedule: ${JSON.stringify(t.schedule)}\n  prompt: ${t.prompt.slice(0, 100)}${t.prompt.length > 100 ? "..." : ""}`,
          );
          return textResult(lines.join("\n\n"));
        }

        case "create": {
          if (!params.label) return textResult("Error: label is required for create");
          if (!params.prompt) return textResult("Error: prompt is required for create");
          if (!params.schedule) return textResult("Error: schedule is required for create");
          const schedule = TaskScheduleSchema.parse(params.schedule);
          const task = createTask({
            label: params.label,
            prompt: params.prompt,
            schedule,
          });
          return textResult(`Created task "${task.label}" (${task.id})`);
        }

        case "toggle": {
          if (!params.taskId) return textResult("Error: taskId is required for toggle");
          try {
            const task = toggleTask(params.taskId);
            return textResult(
              `Task "${task.label}" is now ${task.enabled ? "enabled" : "disabled"}`,
            );
          } catch (err) {
            return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        case "delete": {
          if (!params.taskId) return textResult("Error: taskId is required for delete");
          deleteTask(params.taskId);
          return textResult(`Deleted task ${params.taskId}`);
        }
      }
    },
  };
}
