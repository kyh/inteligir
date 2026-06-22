import { describe, it, expect } from "vitest";

import { formatDue, isOverdue, sortTodos, type Todo } from "@/shared/todo";

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: "t",
    title: "x",
    notes: "",
    done: false,
    priority: "medium",
    dueAt: null,
    createdAt: 0,
    completedAt: null,
    ...over,
  };
}

// A fixed "now": 2026-06-22, 3pm local. The panel stores date-only due dates
// at local noon, so a same-day due (noon) is < now (3pm) as an instant — the
// case that must NOT read as overdue.
const NOW = new Date(2026, 5, 22, 15, 0, 0).getTime();
const NOON_TODAY = new Date(2026, 5, 22, 12, 0, 0).getTime();
const NOON_YESTERDAY = new Date(2026, 5, 21, 12, 0, 0).getTime();
const NOON_TOMORROW = new Date(2026, 5, 23, 12, 0, 0).getTime();

describe("isOverdue (calendar-day semantics)", () => {
  it("is not overdue when due today, even past the stored noon timestamp", () => {
    expect(isOverdue(todo({ dueAt: NOON_TODAY }), NOW)).toBe(false);
  });

  it("is overdue once the due day has fully passed", () => {
    expect(isOverdue(todo({ dueAt: NOON_YESTERDAY }), NOW)).toBe(true);
  });

  it("is not overdue for a future day", () => {
    expect(isOverdue(todo({ dueAt: NOON_TOMORROW }), NOW)).toBe(false);
  });

  it("is never overdue without a due date or when done", () => {
    expect(isOverdue(todo({ dueAt: null }), NOW)).toBe(false);
    expect(isOverdue(todo({ dueAt: NOON_YESTERDAY, done: true }), NOW)).toBe(false);
  });
});

describe("formatDue", () => {
  it("labels relative days", () => {
    expect(formatDue(NOON_TODAY, NOW)).toBe("Today");
    expect(formatDue(NOON_TOMORROW, NOW)).toBe("Tomorrow");
    expect(formatDue(NOON_YESTERDAY, NOW)).toBe("Yesterday");
  });
});

describe("sortTodos", () => {
  it("open before done, then by due date (undated last), done newest-first", () => {
    const open1 = todo({ id: "open-soon", dueAt: NOON_TODAY });
    const open2 = todo({ id: "open-later", dueAt: NOON_TOMORROW });
    const open3 = todo({ id: "open-undated", dueAt: null });
    const done1 = todo({ id: "done-old", done: true, completedAt: 100 });
    const done2 = todo({ id: "done-new", done: true, completedAt: 200 });

    const order = sortTodos([done1, open3, open2, done2, open1]).map((t) => t.id);
    expect(order).toEqual(["open-soon", "open-later", "open-undated", "done-new", "done-old"]);
  });
});
