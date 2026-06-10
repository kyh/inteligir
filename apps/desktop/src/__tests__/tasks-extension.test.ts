import { describe, expect, it, vi, beforeEach } from "vitest";
import { Value } from "@sinclair/typebox/value";

import { buildManageTasksTool } from "@/agent/tasks/extension";
import { validateToolParametersSchema } from "@/agent/extension";
import type { CreateTaskParams, Task } from "@/shared/task";

// The extension receives the task store as a TasksPort (no @/main import),
// so the test injects fakes directly instead of mocking the task manager.
const createTask = vi.fn<(params: CreateTaskParams) => Task>();
const getTasks = vi.fn<() => Task[]>(() => []);
const toggleTask = vi.fn<(id: string) => Task>();
const deleteTask = vi.fn<(id: string) => void>();

const manageTasksTool = buildManageTasksTool({ createTask, getTasks, toggleTask, deleteTask });

function task(over: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    label: "Standup",
    prompt: "Summarize my morning",
    schedule: { type: "interval", intervalMs: 60_000 },
    enabled: true,
    lastRunAt: null,
    createdAt: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_tasks parameters schema", () => {
  it("passes provider root-shape validation (type: object, no root anyOf)", () => {
    expect(() => validateToolParametersSchema(manageTasksTool, "manage_tasks")).not.toThrow();
  });

  it("accepts a full create payload", () => {
    expect(
      Value.Check(manageTasksTool.parameters, {
        action: "create",
        label: "Standup",
        prompt: "Summarize my morning",
        schedule: { type: "cron", cron: "0 9 * * *" },
      }),
    ).toBe(true);
  });

  it("rejects a schedule missing its variant fields", () => {
    expect(
      Value.Check(manageTasksTool.parameters, {
        action: "create",
        label: "Standup",
        prompt: "x",
        schedule: { type: "interval" },
      }),
    ).toBe(false);
  });
});

describe("manage_tasks create", () => {
  it("creates a task from a valid schedule and reports it", async () => {
    createTask.mockImplementation((params) =>
      task({ label: params.label, prompt: params.prompt, schedule: params.schedule }),
    );

    const result = await manageTasksTool.execute("call-1", {
      action: "create",
      label: "Standup",
      prompt: "Summarize my morning",
      schedule: { type: "cron", cron: "0 9 * * *" },
    });

    expect(createTask).toHaveBeenCalledWith({
      label: "Standup",
      prompt: "Summarize my morning",
      schedule: { type: "cron", cron: "0 9 * * *" },
    });
    expect(result.content[0].text).toBe('Created task "Standup" (task-1)');
  });

  it("returns a tool error (not a throw) for a schedule that fails Value.Check", async () => {
    // intervalMs: 0 typechecks (number) but violates Integer({ minimum: 1 })
    // — exactly the class of input that slips past static types.
    const result = await manageTasksTool.execute("call-1", {
      action: "create",
      label: "Standup",
      prompt: "Summarize my morning",
      schedule: { type: "interval", intervalMs: 0 },
    });

    expect(result.content[0].text).toMatch(/^Error: invalid 'schedule'/);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("returns a tool error for a non-integer intervalMs", async () => {
    const result = await manageTasksTool.execute("call-1", {
      action: "create",
      label: "Standup",
      prompt: "x",
      schedule: { type: "interval", intervalMs: 2.5 },
    });

    expect(result.content[0].text).toMatch(/^Error: invalid 'schedule'/);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("returns a tool error when schedule is missing", async () => {
    const result = await manageTasksTool.execute("call-1", {
      action: "create",
      label: "Standup",
      prompt: "x",
    });

    expect(result.content[0].text).toBe("Error: 'schedule' is required for action 'create'.");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("returns a tool error when label is missing", async () => {
    const result = await manageTasksTool.execute("call-1", {
      action: "create",
      prompt: "x",
      schedule: { type: "once", runAt: 0 },
    });

    expect(result.content[0].text).toBe("Error: 'label' is required for action 'create'.");
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("manage_tasks list", () => {
  it("reports when no tasks are configured", async () => {
    const result = await manageTasksTool.execute("call-1", { action: "list" });
    expect(result.content[0].text).toBe("No tasks configured.");
  });

  it("lists tasks with enabled state and schedule", async () => {
    getTasks.mockReturnValue([task()]);
    const result = await manageTasksTool.execute("call-1", { action: "list" });
    expect(result.content[0].text).toContain("[ON] Standup (task-1)");
    expect(result.content[0].text).toContain('"type":"interval"');
  });
});
