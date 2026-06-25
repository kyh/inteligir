import { describe, it, expect } from "vitest";

import { dueToEpoch, parseGoogleTasks, planSync, todoToWriteFields } from "@/shared/google-tasks";
import type { GoogleTask } from "@/shared/google-tasks";
import type { Todo } from "@/shared/todo";

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: "t",
    title: "x",
    notes: "",
    done: false,
    priority: "medium",
    dueAt: null,
    createdAt: 0,
    updatedAt: 1000,
    completedAt: null,
    googleTaskId: null,
    ...over,
  };
}

function gtask(over: Partial<GoogleTask> = {}): GoogleTask {
  return {
    id: "g",
    title: "x",
    notes: "",
    status: "needsAction",
    due: null,
    updated: "2026-06-22T00:00:00.000Z",
    completed: null,
    ...over,
  };
}

let idCounter = 0;
const newId = () => `new-${++idCounter}`;

describe("parseGoogleTasks", () => {
  it("parses valid tasks, dropping items without id/updated", () => {
    const tasks = parseGoogleTasks([
      { id: "a", title: "A", status: "completed", updated: "2026-06-22T00:00:00Z" },
      { id: "b", title: "B", updated: "2026-06-22T00:00:00Z", due: "2026-06-25T00:00:00.000Z" },
      { id: "no-updated", title: "C" }, // dropped
      { title: "no-id", updated: "2026-06-22T00:00:00Z" }, // dropped
    ]);
    expect(tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(tasks[0]?.status).toBe("completed");
    expect(tasks[1]?.due).toBe("2026-06-25T00:00:00.000Z");
  });
});

describe("dueToEpoch / todoToWriteFields round trip", () => {
  it("maps a due date to local noon and back to a date-only RFC3339", () => {
    const ms = dueToEpoch("2026-06-25T00:00:00.000Z");
    expect(ms).not.toBeNull();
    const fields = todoToWriteFields(todo({ dueAt: ms }));
    expect(fields.due).toBe("2026-06-25T00:00:00.000Z");
  });

  it("omits due when there is none and maps done -> completed", () => {
    expect(todoToWriteFields(todo({ done: true })).status).toBe("completed");
    expect(todoToWriteFields(todo()).due).toBeUndefined();
  });
});

describe("planSync", () => {
  it("exports an unlinked local todo", () => {
    const plan = planSync([todo({ id: "local1", title: "New" })], [], 5000, newId);
    expect(plan.remoteCreates).toEqual([
      { localId: "local1", fields: { title: "New", notes: "", status: "needsAction" } },
    ]);
    expect(plan.localImports).toEqual([]);
    expect(plan.localUpdates).toEqual([]);
  });

  it("imports a remote task with no local match", () => {
    const plan = planSync([], [gtask({ id: "g1", title: "Remote" })], 5000, newId);
    expect(plan.localImports).toHaveLength(1);
    expect(plan.localImports[0]).toMatchObject({ title: "Remote", googleTaskId: "g1" });
    expect(plan.localUpdates).toEqual([]);
  });

  it("local wins when its edit is newer than the remote", () => {
    const local = todo({
      id: "l",
      googleTaskId: "g1",
      title: "Local edit",
      updatedAt: 9_999_999_999_999,
    });
    const remote = gtask({ id: "g1", title: "Stale", updated: "2026-06-22T00:00:00.000Z" });
    const plan = planSync([local], [remote], 5000, newId);
    expect(plan.remoteUpdates).toEqual([
      { googleTaskId: "g1", fields: { title: "Local edit", notes: "", status: "needsAction" } },
    ]);
    expect(plan.localImports).toEqual([]);
    expect(plan.localUpdates).toEqual([]);
  });

  it("remote wins when it is newer, preserving local-only priority", () => {
    const local = todo({ id: "l", googleTaskId: "g1", priority: "high", updatedAt: 1 });
    const remote = gtask({ id: "g1", title: "Remote edit", updated: "2999-01-01T00:00:00.000Z" });
    const plan = planSync([local], [remote], 5000, newId);
    expect(plan.remoteUpdates).toEqual([]);
    expect(plan.localUpdates[0]).toMatchObject({
      id: "l",
      title: "Remote edit",
      priority: "high",
      googleTaskId: "g1",
    });
  });

  it("deletes a local todo whose linked remote task is gone", () => {
    const plan = planSync([todo({ id: "l", googleTaskId: "g1" })], [], 5000, newId);
    expect(plan.localDeletes).toEqual(["l"]);
    expect(plan.remoteCreates).toEqual([]);
  });

  it("first-sync dedup: links an unlinked local to a same-title remote instead of duplicating", () => {
    // Same work on both sides, neither linked: must adopt, not duplicate.
    // Match is case/whitespace-insensitive; adopted content keeps remote's text.
    const local = todo({ id: "l", title: "Buy Milk", updatedAt: 1 });
    const remote = gtask({ id: "g1", title: "buy milk", updated: "2999-01-01T00:00:00.000Z" });
    const plan = planSync([local], [remote], 5000, newId);

    expect(plan.remoteCreates).toEqual([]); // not re-exported
    expect(plan.localImports).toEqual([]); // not re-imported
    // Remote is newer here, so local adopts remote content + the link.
    expect(plan.localUpdates[0]).toMatchObject({ id: "l", title: "buy milk", googleTaskId: "g1" });
  });

  it("first-sync dedup: local-newer pushes content to the adopted remote and links it", () => {
    const local = todo({ id: "l", title: "Ship it", updatedAt: 9_999_999_999_999 });
    const remote = gtask({ id: "g1", title: "ship it", updated: "2026-06-22T00:00:00.000Z" });
    const plan = planSync([local], [remote], 5000, newId);

    expect(plan.remoteUpdates).toEqual([
      { googleTaskId: "g1", fields: { title: "Ship it", notes: "", status: "needsAction" } },
    ]);
    expect(plan.localUpdates[0]).toMatchObject({ id: "l", googleTaskId: "g1" });
    expect(plan.remoteCreates).toEqual([]);
    expect(plan.localImports).toEqual([]);
  });

  it("does not steal an id-linked remote for a same-title unlinked local", () => {
    // g1 is already linked to another local; a same-title unlinked local must
    // export a new task, not hijack g1.
    const linked = todo({ id: "a", title: "Report", googleTaskId: "g1", updatedAt: 1 });
    const unlinked = todo({ id: "b", title: "Report", updatedAt: 1 });
    const remote = gtask({ id: "g1", title: "Report", updated: "2999-01-01T00:00:00.000Z" });
    const plan = planSync([linked, unlinked], [remote], 5000, newId);

    expect(plan.remoteCreates).toEqual([
      { localId: "b", fields: { title: "Report", notes: "", status: "needsAction" } },
    ]);
  });
});
