import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@repo/ui/lib/utils";

import {
  buildAgenda,
  formatItemTime,
  parseCalendarEvents,
  type AgendaEventItem,
  type AgendaItem,
  type AgendaTodoItem,
} from "@/shared/agenda";
import type { TodoPriority } from "@/shared/todo";
import { isRecord } from "@/shared/ipc";
import { getBridge } from "@/renderer/lib/bridge";
import { useTodoStore } from "@/renderer/stores/todo-store";

const DOT_BY_PRIORITY: Record<TodoPriority, string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-muted-foreground/40",
};

// The calendar tool address: <integration>.<owner>.<connection>.<method>. The
// connectors flow binds Google under owner "user", connection "default" — the
// same address the old Up Next seed widget used.
const CALENDAR_TOOL = "google_calendar.user.default.calendar.events.list";
const LOOKAHEAD_DAYS = 14;

type CalState =
  | { status: "loading" }
  | { status: "ready"; events: AgendaEventItem[] }
  | { status: "error"; message: string };

function extractItems(data: unknown): unknown {
  // events.list returns { items: [...] }; tolerate a bare array too.
  if (Array.isArray(data)) return data;
  if (isRecord(data) && "items" in data) return data["items"];
  return [];
}

// ---------------------------------------------------------------------------
// Row renderers
// ---------------------------------------------------------------------------

function EventRow({ item }: { item: AgendaEventItem }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-xs hover:bg-hover">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" title="Event" />
      <span className="min-w-0 flex-1 truncate" title={item.title}>
        {item.title}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{formatItemTime(item)}</span>
    </div>
  );
}

function TodoRow({ item }: { item: AgendaTodoItem }) {
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  return (
    <div className="group flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-xs hover:bg-hover">
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border border-muted-foreground/40 transition-colors hover:border-foreground"
        onClick={() => void toggleTodo(item.id)}
        title="Complete"
      />
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_BY_PRIORITY[item.priority])} />
      <span className="min-w-0 flex-1 truncate" title={item.title}>
        {item.title}
      </span>
    </div>
  );
}

function ItemRow({ item }: { item: AgendaItem }) {
  return item.kind === "event" ? <EventRow item={item} /> : <TodoRow item={item} />;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function AgendaPanel() {
  const todos = useTodoStore((s) => s.todos);
  const initTodos = useTodoStore((s) => s.init);
  const [cal, setCal] = useState<CalState>({ status: "loading" });

  useEffect(() => initTodos(), [initTodos]);

  const loadCalendar = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    setCal({ status: "loading" });
    const now = new Date();
    const timeMax = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    void bridge
      .widgetCallTool({
        tool: CALENDAR_TOOL,
        input: {
          calendarId: "primary",
          timeMin: now.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 50,
        },
      })
      .then((res) =>
        setCal(
          res.ok
            ? { status: "ready", events: parseCalendarEvents(extractItems(res.data)) }
            : { status: "error", message: res.error },
        ),
      )
      .catch((err: unknown) => {
        setCal({ status: "error", message: err instanceof Error ? err.message : "Unknown error" });
      });
  }, []);

  useEffect(() => loadCalendar(), [loadCalendar]);

  const agenda = useMemo(() => {
    const events = cal.status === "ready" ? cal.events : [];
    return buildAgenda(events, todos, Date.now());
  }, [cal, todos]);

  const isEmpty = agenda.overdue.length === 0 && agenda.days.length === 0;

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">Agenda</span>
        <button
          type="button"
          className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={loadCalendar}
        >
          refresh
        </button>
      </div>

      {/* The calendar source being unconnected is the expected first-run state,
          not an error — surface a connect hint rather than the raw tool error. */}
      {cal.status === "error" && (
        <div className="mb-2 rounded-[10px] bg-hover px-2.5 py-2 text-[10px] text-muted-foreground">
          Connect Google Calendar in Extensions to see meetings alongside your to-dos.
        </div>
      )}

      {isEmpty && cal.status !== "loading" && (
        <div className="py-4 text-center text-[10px] text-muted-foreground">
          Nothing scheduled or due
        </div>
      )}

      {agenda.overdue.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-red-400">
            Overdue
          </div>
          <div className="flex flex-col gap-0.5">
            {agenda.overdue.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {agenda.days.map((day) => (
        <div key={day.key} className="mb-3">
          <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {day.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {day.items.map((item) => (
              <ItemRow key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
