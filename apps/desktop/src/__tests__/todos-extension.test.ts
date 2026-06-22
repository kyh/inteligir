import { describe, expect, it, vi, beforeEach } from "vitest";
import { Value } from "@sinclair/typebox/value";

import { buildManageTodosTool } from "@/agent/todos/extension";
import { validateToolParametersSchema } from "@/agent/extension";
import type { CreateTodoParams, Todo, UpdateTodoParams } from "@/shared/todo";

// The extension receives the store as a TodosPort (no @/main import), so the
// test injects fakes directly instead of mocking the todo manager.
const createTodo = vi.fn<(params: CreateTodoParams) => Todo>();
const getTodos = vi.fn<() => Todo[]>(() => []);
const updateTodo = vi.fn<(params: UpdateTodoParams) => Todo>();
const toggleTodo = vi.fn<(id: string) => Todo>();
const deleteTodo = vi.fn<(id: string) => void>();
const clearCompleted = vi.fn<() => Todo[]>(() => []);

const tool = buildManageTodosTool({
  createTodo,
  getTodos,
  updateTodo,
  toggleTodo,
  deleteTodo,
  clearCompleted,
});

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: "todo-1",
    title: "Buy milk",
    notes: "",
    done: false,
    priority: "medium",
    dueAt: null,
    createdAt: 0,
    completedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_todos parameters schema", () => {
  it("passes provider root-shape validation (type: object, no root anyOf)", () => {
    expect(() => validateToolParametersSchema(tool, "manage_todos")).not.toThrow();
  });

  it("accepts a create payload with priority and due date", () => {
    expect(
      Value.Check(tool.parameters, {
        action: "create",
        title: "Ship it",
        priority: "high",
        dueAt: 1234,
      }),
    ).toBe(true);
  });

  it("accepts dueAt: null to clear a date", () => {
    expect(Value.Check(tool.parameters, { action: "update", todoId: "x", dueAt: null })).toBe(true);
  });

  it("rejects an unknown priority", () => {
    expect(Value.Check(tool.parameters, { action: "create", title: "x", priority: "urgent" })).toBe(
      false,
    );
  });
});

describe("manage_todos create", () => {
  it("creates a todo and reports it", async () => {
    createTodo.mockImplementation((params) => todo({ title: params.title }));

    const result = await tool.execute("call-1", {
      action: "create",
      title: "Buy milk",
      priority: "high",
    });

    expect(createTodo).toHaveBeenCalledWith({ title: "Buy milk", priority: "high" });
    expect(result.content[0].text).toBe('Added "Buy milk" (todo-1)');
  });

  it("omits unset optional keys rather than passing undefined", async () => {
    createTodo.mockImplementation((params) => todo({ title: params.title }));

    await tool.execute("call-1", { action: "create", title: "Bare" });

    expect(createTodo).toHaveBeenCalledWith({ title: "Bare" });
  });

  it("returns a tool error when title is missing", async () => {
    const result = await tool.execute("call-1", { action: "create" });
    expect(result.content[0].text).toBe("Error: 'title' is required for action 'create'.");
    expect(createTodo).not.toHaveBeenCalled();
  });
});

describe("manage_todos update", () => {
  it("forwards dueAt: null to clear the date", async () => {
    updateTodo.mockImplementation(() => todo({ dueAt: null }));

    await tool.execute("call-1", { action: "update", todoId: "todo-1", dueAt: null });

    expect(updateTodo).toHaveBeenCalledWith({ id: "todo-1", dueAt: null });
  });

  it("leaves dueAt untouched when omitted", async () => {
    updateTodo.mockImplementation(() => todo());

    await tool.execute("call-1", { action: "update", todoId: "todo-1", title: "New" });

    expect(updateTodo).toHaveBeenCalledWith({ id: "todo-1", title: "New" });
  });

  it("returns a tool error when todoId is missing", async () => {
    const result = await tool.execute("call-1", { action: "update", title: "x" });
    expect(result.content[0].text).toBe("Error: 'todoId' is required for action 'update'.");
    expect(updateTodo).not.toHaveBeenCalled();
  });
});

describe("manage_todos list / toggle / clear", () => {
  it("reports an empty list", async () => {
    const result = await tool.execute("call-1", { action: "list" });
    expect(result.content[0].text).toBe("The to-do list is empty.");
  });

  it("lists items with checkbox state and priority", async () => {
    getTodos.mockReturnValue([todo({ done: true }), todo({ id: "todo-2", title: "Walk dog" })]);
    const result = await tool.execute("call-1", { action: "list" });
    expect(result.content[0].text).toContain("[x] Buy milk (todo-1) — medium");
    expect(result.content[0].text).toContain("[ ] Walk dog (todo-2) — medium");
  });

  it("toggles and reports the new state", async () => {
    toggleTodo.mockReturnValue(todo({ done: true }));
    const result = await tool.execute("call-1", { action: "toggle", todoId: "todo-1" });
    expect(result.content[0].text).toBe('"Buy milk" is now done');
  });

  it("clears completed and reports the remaining count", async () => {
    clearCompleted.mockReturnValue([todo()]);
    const result = await tool.execute("call-1", { action: "clear_completed" });
    expect(result.content[0].text).toBe("Cleared completed items. 1 remaining.");
  });
});
