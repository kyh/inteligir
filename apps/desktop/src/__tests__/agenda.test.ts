import { describe, it, expect } from "vitest";

import {
  buildAgenda,
  formatItemTime,
  parseCalendarEvents,
  type AgendaEventItem,
} from "@/shared/agenda";
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
    updatedAt: 0,
    completedAt: null,
    googleTaskId: null,
    ...over,
  };
}

const NOW = new Date(2026, 5, 22, 9, 0, 0).getTime(); // 2026-06-22 09:00 local
const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0).getTime();
const at = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h, 0, 0).getTime();

describe("parseCalendarEvents", () => {
  it("parses timed and all-day events, skipping malformed items", () => {
    const events = parseCalendarEvents([
      { id: "a", summary: "Standup", start: { dateTime: "2026-06-22T10:00:00" } },
      { id: "b", summary: "Holiday", start: { date: "2026-06-23" } },
      { id: "c", summary: "no start" }, // skipped: no start
      { summary: "no id", start: { date: "2026-06-23" } }, // skipped: no id
      "garbage", // skipped: not an object
    ]);
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(events[0]).toMatchObject({ allDay: false, title: "Standup" });
    expect(events[1]).toMatchObject({ allDay: true, title: "Holiday" });
  });

  it("defaults a missing summary and tolerates a bare array / non-array", () => {
    expect(parseCalendarEvents("nope")).toEqual([]);
    const [event] = parseCalendarEvents([{ id: "a", start: { date: "2026-06-23" } }]);
    expect(event?.title).toBe("(no title)");
  });
});

describe("buildAgenda", () => {
  it("groups events and due todos by day, sorts within a day, all-day first", () => {
    const events: AgendaEventItem[] = [
      { kind: "event", id: "mtg", title: "Meeting", start: at(2026, 5, 22, 14), allDay: false },
      { kind: "event", id: "hol", title: "Holiday", start: noon(2026, 5, 22), allDay: true },
    ];
    const todos = [
      todo({ id: "td", title: "Email", dueAt: at(2026, 5, 22, 10) }),
      todo({ id: "tomorrow", title: "Later", dueAt: noon(2026, 5, 23) }),
    ];

    const agenda = buildAgenda(events, todos, NOW);

    expect(agenda.days[0]?.label).toBe("Today");
    // all-day event first, then 10:00 todo, then 14:00 meeting
    expect(agenda.days[0]?.items.map((i) => i.id)).toEqual(["hol", "td", "mtg"]);
    expect(agenda.days[1]?.label).toBe("Tomorrow");
    expect(agenda.days[1]?.items.map((i) => i.id)).toEqual(["tomorrow"]);
  });

  it("puts past-due open todos in the overdue bucket, soonest first", () => {
    const todos = [
      todo({ id: "old", dueAt: noon(2026, 5, 20) }),
      todo({ id: "older", dueAt: noon(2026, 5, 19) }),
    ];
    const agenda = buildAgenda([], todos, NOW);
    expect(agenda.overdue.map((i) => i.id)).toEqual(["older", "old"]);
    expect(agenda.days).toEqual([]);
  });

  it("excludes done todos and undated todos", () => {
    const todos = [
      todo({ id: "done", dueAt: noon(2026, 5, 22), done: true }),
      todo({ id: "undated", dueAt: null }),
    ];
    const agenda = buildAgenda([], todos, NOW);
    expect(agenda.overdue).toEqual([]);
    expect(agenda.days).toEqual([]);
  });

  it("treats a todo due today (local noon) as today, not overdue", () => {
    const agenda = buildAgenda([], [todo({ id: "x", dueAt: noon(2026, 5, 22) })], NOW);
    expect(agenda.overdue).toEqual([]);
    expect(agenda.days[0]?.label).toBe("Today");
  });
});

describe("formatItemTime", () => {
  it("renders 'all day' for all-day events and '' for todos", () => {
    expect(
      formatItemTime({
        kind: "event",
        id: "a",
        title: "x",
        start: noon(2026, 5, 22),
        allDay: true,
      }),
    ).toBe("all day");
    expect(
      formatItemTime({
        kind: "todo",
        id: "t",
        title: "x",
        due: noon(2026, 5, 22),
        priority: "low",
        done: false,
      }),
    ).toBe("");
  });
});
