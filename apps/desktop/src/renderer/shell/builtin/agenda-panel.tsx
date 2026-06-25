import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
// Re-derive day labels / overdue bucket on a coarse tick so they don't go
// stale across midnight (or as a due item crosses into overdue) while idle.
const CLOCK_TICK_MS = 60_000;

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
  // Events persist across reloads so a refresh doesn't blank already-shown
  // meetings while the next fetch is in flight.
  const [events, setEvents] = useState<AgendaEventItem[]>([]);
  const [calError, setCalError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Monotonic request id so a slow refresh can't overwrite a newer one.
  const reqRef = useRef(0);

  useEffect(() => initTodos(), [initTodos]);

  // Coarse clock so day labels / the overdue bucket stay correct over time.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const loadCalendar = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) {
      setCalError("Calendar bridge unavailable");
      setLoaded(true);
      return;
    }
    const req = ++reqRef.current;
    const start = new Date();
    const timeMax = new Date(start.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    // Apply a settled response only if it's still the latest request. Keep the
    // previously-loaded events on failure rather than dropping them.
    const apply = (res: { ok: true; data: unknown } | { ok: false; error: string }): void => {
      if (res.ok) {
        setEvents(parseCalendarEvents(extractItems(res.data)));
        setCalError(null);
      } else {
        setCalError(res.error);
      }
      setLoaded(true);
    };
    void bridge
      .widgetCallTool({
        tool: CALENDAR_TOOL,
        input: {
          calendarId: "primary",
          timeMin: start.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 50,
        },
      })
      .then((res) => (req === reqRef.current ? apply(res) : undefined))
      .catch((err: unknown) => {
        if (req === reqRef.current) {
          setCalError(err instanceof Error ? err.message : "Unknown error");
          setLoaded(true);
        }
      });
  }, []);

  useEffect(() => loadCalendar(), [loadCalendar]);

  const agenda = useMemo(() => buildAgenda(events, todos, now), [events, todos, now]);

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

      {/* A calendar error with no events is the expected unconnected first-run
          state — surface a connect hint rather than the raw tool error. (Once
          events have loaded, a transient refresh error is left silent.) */}
      {calError !== null && events.length === 0 && (
        <div className="mb-2 rounded-[10px] bg-hover px-2.5 py-2 text-[10px] text-muted-foreground">
          Connect Google Calendar in Extensions to see meetings alongside your to-dos.
        </div>
      )}

      {isEmpty && loaded && (
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
