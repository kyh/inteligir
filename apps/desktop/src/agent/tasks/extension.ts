/**
 * Scheduled tasks extension — exposes the manage_tasks tool and primes each
 * agent turn with the active task list so the model knows what's running on
 * its behalf. Task storage is main-owned; it arrives through ports.tasks.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { TaskScheduleSchema } from "@/shared/task";
import { toErrorMessage } from "@/shared/ipc";
import type { PiExtensionBundle, TasksPort } from "@/agent/extension";
import { textResult } from "@/agent/extension-helpers";

const manageTasksSchema = Type.Object({
  action: Type.Union(
    [Type.Literal("create"), Type.Literal("list"), Type.Literal("toggle"), Type.Literal("delete")],
    { description: "Action to perform" },
  ),
  label: Type.Optional(Type.String({ description: "Task label (required for create)" })),
  prompt: Type.Optional(
    Type.String({ description: "Prompt to run when task fires (required for create)" }),
  ),
  // Real union in property position is fine — providers only reject anyOf at
  // the schema ROOT (see validateToolParametersSchema in agent/extension.ts).
  schedule: Type.Optional(TaskScheduleSchema),
  taskId: Type.Optional(Type.String({ description: "Task ID (required for toggle/delete)" })),
});

/** Exported for unit testing — see __tests__/tasks-extension.test.ts. */
export function buildManageTasksTool(tasks: TasksPort) {
  return {
    name: "manage_tasks",
    label: "manage_tasks",
    description:
      "Create, list, toggle, or delete scheduled tasks. " +
      "Tasks run automatically on a cron/interval/once schedule.",
    parameters: manageTasksSchema,
    execute: async (_toolCallId: string, params: Static<typeof manageTasksSchema>) => {
      const p = params;

      switch (p.action) {
        case "list": {
          const all = tasks.getTasks();
          if (all.length === 0) return textResult("No tasks configured.");
          const lines = all.map(
            (t) =>
              `- [${t.enabled ? "ON" : "OFF"}] ${t.label} (${t.id})\n  schedule: ${JSON.stringify(t.schedule)}\n  prompt: ${t.prompt.slice(0, 100)}${t.prompt.length > 100 ? "..." : ""}`,
          );
          return textResult(lines.join("\n\n"));
        }
        case "create": {
          if (!p.label) return textResult("Error: 'label' is required for action 'create'.");
          if (!p.prompt) return textResult("Error: 'prompt' is required for action 'create'.");
          if (!p.schedule) return textResult("Error: 'schedule' is required for action 'create'.");
          // Runtime re-check: static types are erased and provider-supplied
          // args can drift from the schema. A miss returns a self-correcting
          // tool error (manage_ui pattern) instead of crashing the turn.
          if (!Value.Check(TaskScheduleSchema, p.schedule)) {
            return textResult(
              "Error: invalid 'schedule' for action 'create' — expected " +
                "{type:'cron',cron:string} | {type:'interval',intervalMs:number} | {type:'once',runAt:number}.",
            );
          }
          const task = tasks.createTask({
            label: p.label,
            prompt: p.prompt,
            schedule: p.schedule,
          });
          return textResult(`Created task "${task.label}" (${task.id})`);
        }
        case "toggle": {
          if (!p.taskId) return textResult("Error: 'taskId' is required for action 'toggle'.");
          try {
            const task = tasks.toggleTask(p.taskId);
            return textResult(
              `Task "${task.label}" is now ${task.enabled ? "enabled" : "disabled"}`,
            );
          } catch (err) {
            return textResult(`Error: ${toErrorMessage(err)}`);
          }
        }
        case "delete": {
          if (!p.taskId) return textResult("Error: 'taskId' is required for action 'delete'.");
          tasks.deleteTask(p.taskId);
          return textResult(`Deleted task ${p.taskId}`);
        }
      }
    },
  };
}

const tasksExtension: PiExtensionBundle = {
  name: "manage_tasks",
  register:
    ({ ports }) =>
    (pi) => {
      pi.registerTool(buildManageTasksTool(ports.tasks));

      pi.on("before_agent_start", (_event, _ctx) => {
        const tasks = ports.tasks.getTasks().filter((t) => t.enabled);
        if (tasks.length === 0) return;

        const summary = tasks
          .map(
            (t) =>
              `- ${t.label}: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? "..." : ""} (${t.schedule.type})`,
          )
          .join("\n");

        pi.sendMessage({
          customType: "scheduled-tasks",
          content: `[Active scheduled tasks]\n${summary}`,
          display: false,
        });
      });
    },
};

export default tasksExtension;
