/**
 * Scheduled tasks extension — exposes the manage_tasks tool and primes each
 * agent turn with the active task list so the model knows what's running on
 * its behalf.
 */

import { Type, type Static } from "@sinclair/typebox";

import { taskManager } from "@/main/tasks/task-singleton";
import { TaskScheduleSchema, type TaskSchedule } from "@/shared/task";
import { toErrorMessage } from "@/shared/ipc";
import type { PiExtensionBundle } from "@/agent/extension";
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
  schedule: Type.Optional(
    Type.Unsafe<TaskSchedule>({
      description:
        "Schedule: {type:'cron',cron:string} | {type:'interval',intervalMs:number} | {type:'once',runAt:number}",
    }),
  ),
  taskId: Type.Optional(Type.String({ description: "Task ID (required for toggle/delete)" })),
});

const tasksExtension: PiExtensionBundle = {
  name: "manage_tasks",
  register: () => (pi) => {
    pi.registerTool({
      name: "manage_tasks",
      label: "manage_tasks",
      description:
        "Create, list, toggle, or delete scheduled tasks. " +
        "Tasks run automatically on a cron/interval/once schedule.",
      parameters: manageTasksSchema,
      execute: async (_toolCallId, params: Static<typeof manageTasksSchema>) => {
        const p = params;

        switch (p.action) {
          case "list": {
            const tasks = taskManager.getTasks();
            if (tasks.length === 0) return textResult("No tasks configured.");
            const lines = tasks.map(
              (t) =>
                `- [${t.enabled ? "ON" : "OFF"}] ${t.label} (${t.id})\n  schedule: ${JSON.stringify(t.schedule)}\n  prompt: ${t.prompt.slice(0, 100)}${t.prompt.length > 100 ? "..." : ""}`,
            );
            return textResult(lines.join("\n\n"));
          }
          case "create": {
            if (!p.label) return textResult("Error: label is required for create");
            if (!p.prompt) return textResult("Error: prompt is required for create");
            if (!p.schedule) return textResult("Error: schedule is required for create");
            const schedule = TaskScheduleSchema.parse(p.schedule);
            const task = taskManager.createTask({ label: p.label, prompt: p.prompt, schedule });
            return textResult(`Created task "${task.label}" (${task.id})`);
          }
          case "toggle": {
            if (!p.taskId) return textResult("Error: taskId is required for toggle");
            try {
              const task = taskManager.toggleTask(p.taskId);
              return textResult(
                `Task "${task.label}" is now ${task.enabled ? "enabled" : "disabled"}`,
              );
            } catch (err) {
              return textResult(`Error: ${toErrorMessage(err)}`);
            }
          }
          case "delete": {
            if (!p.taskId) return textResult("Error: taskId is required for delete");
            taskManager.deleteTask(p.taskId);
            return textResult(`Deleted task ${p.taskId}`);
          }
        }
      },
    });

    pi.on("before_agent_start", (_event, _ctx) => {
      const tasks = taskManager.getTasks().filter((t) => t.enabled);
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
