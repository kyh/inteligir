// Pure logic for the unified Agenda: merge Google Calendar events with
// due-dated to-dos into one time-ordered, day-grouped list. Shared so the
// Agenda panel and any future agent surface read the same shape. No I/O here —
// callers pass already-fetched calendar items and the local todo list.

import { formatDue, type Todo, type TodoPriority } from "@/shared/todo";

// ---------------------------------------------------------------------------
// Item + group shapes
// ---------------------------------------------------------------------------

export type AgendaEventItem = {
  kind: "event";
  id: string;
  title: string;
  /** Epoch ms start, or null for an all-day event. */
  start: number | null;
  allDay: boolean;
};

export type AgendaTodoItem = {
  kind: "todo";
  id: string;
  title: string;
  /** Epoch ms due (date-only todos are stored at local noon). */
  due: number;
  priority: TodoPriority;
  done: boolean;
};

export type AgendaItem = AgendaEventItem | AgendaTodoItem;

type AgendaDay = {
  /** start-of-day epoch ms — the group key. */
  key: number;
  /** "Today" / "Tomorrow" / "Fri" / "Jun 25". */
  label: string;
  items: AgendaItem[];
};

export type Agenda = {
  /** Open, past-due todos (calendar events in the past aren't fetched). */
  overdue: AgendaTodoItem[];
  days: AgendaDay[];
};

// ---------------------------------------------------------------------------
// Date helpers (local time)
// ---------------------------------------------------------------------------

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Google all-day events carry a `date` ("YYYY-MM-DD"); parse at local noon so
// the day never flips across a timezone boundary (same trick the To-Do panel
// uses for date-only due dates).
function parseAllDayDate(date: string): number | null {
  const ms = new Date(`${date}T12:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ---------------------------------------------------------------------------
// Calendar parsing — defensive: the executor returns raw Google JSON, so every
// field is validated before use and malformed items are skipped.
// ---------------------------------------------------------------------------

/** Parse Google Calendar `events.list` items into AgendaEventItems, dropping
 * any that lack a usable id or start. `start.dateTime` is a timed event;
 * `start.date` is all-day. */
export function parseCalendarEvents(items: unknown): AgendaEventItem[] {
  if (!Array.isArray(items)) return [];
  const out: AgendaEventItem[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const id = typeof raw["id"] === "string" ? raw["id"] : null;
    if (!id) continue;
    const start = isRecord(raw["start"]) ? raw["start"] : null;
    if (!start) continue;
    const title = typeof raw["summary"] === "string" ? raw["summary"] : "(no title)";

    if (typeof start["dateTime"] === "string") {
      const ms = new Date(start["dateTime"]).getTime();
      if (Number.isNaN(ms)) continue;
      out.push({ kind: "event", id, title, start: ms, allDay: false });
    } else if (typeof start["date"] === "string") {
      const ms = parseAllDayDate(start["date"]);
      if (ms === null) continue;
      out.push({ kind: "event", id, title, start: ms, allDay: true });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

// Sort key within a day: all-day events sink to the top (-Infinity), then timed
// items by their instant. Event-before-todo breaks ties so a meeting reads
// above a todo due the same minute.
function sortKey(item: AgendaItem): number {
  if (item.kind === "event") return item.allDay ? Number.NEGATIVE_INFINITY : (item.start ?? 0);
  return item.due;
}

/** Merge calendar events and due-dated open todos into day groups, plus an
 * `overdue` bucket for todos whose due day has passed. Events and todos with
 * no date are ignored (an undated todo lives only in the To-Do panel). Done
 * todos are excluded. Pure — `now` is injected for testability. */
export function buildAgenda(
  events: AgendaEventItem[],
  todos: Todo[],
  now: number = Date.now(),
): Agenda {
  const today = startOfDay(now);

  const overdue: AgendaTodoItem[] = [];
  const byDay = new Map<number, AgendaItem[]>();
  const push = (day: number, item: AgendaItem): void => {
    const bucket = byDay.get(day);
    if (bucket) bucket.push(item);
    else byDay.set(day, [item]);
  };

  for (const event of events) {
    if (event.start === null) continue;
    push(startOfDay(event.start), event);
  }

  for (const todo of todos) {
    if (todo.done || todo.dueAt === null) continue;
    const item: AgendaTodoItem = {
      kind: "todo",
      id: todo.id,
      title: todo.title,
      due: todo.dueAt,
      priority: todo.priority,
      done: todo.done,
    };
    const day = startOfDay(todo.dueAt);
    if (day < today) overdue.push(item);
    else push(day, item);
  }

  const days: AgendaDay[] = [...byDay.keys()]
    .toSorted((a, b) => a - b)
    .map((key) => ({
      key,
      label: formatDue(key, now),
      items: (byDay.get(key) ?? []).toSorted((a, b) => sortKey(a) - sortKey(b)),
    }));

  return { overdue: overdue.toSorted((a, b) => a.due - b.due), days };
}

/** Render an item's time for display: "2:00 PM", "all day", or "" for a todo
 * stored at local noon (date-only) which would otherwise read a fake "12:00". */
export function formatItemTime(item: AgendaItem): string {
  if (item.kind === "event") {
    if (item.allDay || item.start === null) return "all day";
    return new Date(item.start).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return "";
}
