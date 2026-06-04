// Default dashboard widgets seeded on first run. Each widget is a json-ui
// spec rendered through WidgetViewer; onMount actions populate their state
// live (no user click required) from local time, open-meteo, the agent, or
// the user's connected integrations.
//
// Layout occupies the full 12-column grid (chat is launched from the dock,
// not pre-placed). Three rows modeled on patina.md's hero showcase:
//   y=0  Date(3) Weather(3) Today(6)
//   y=4  Meeting Prep(6)   Up Next(6)
//   y=8  People(5)         To Do(7)

import type { JsonUiWidgetDef, WidgetInstance } from "@/shared/shell";
import { parseWidgetSpec, type WidgetSpec } from "@/shared/widget-spec";

// Stable timestamp for seed defs — Date.now() at seed time would mark every
// fresh install as "updated now", breaking equality comparisons in tests and
// pushing a meaningless updatedAt forward on every launch.
const SEED_TS = 0;

type SeedDef = {
  id: string;
  title: string;
  description: string;
  defaultGeometry: { x: number; y: number; w: number; h: number; minW?: number; minH?: number };
  spec: WidgetSpec;
};

const DATE_WIDGET: SeedDef = {
  id: "date",
  title: "Date",
  description: "Today's day name and date.",
  defaultGeometry: { x: 0, y: 0, w: 3, h: 4, minW: 2, minH: 3 },
  spec: {
    root: "card",
    elements: {
      card: { type: "Card", props: {}, children: ["stack"] },
      stack: { type: "Stack", props: { gap: "sm" }, children: ["day", "num"] },
      day: {
        type: "Heading",
        props: { text: { $bindState: "/dayShort" }, level: "3" },
      },
      num: {
        type: "Heading",
        props: { text: { $bindState: "/dayNum" }, level: "1" },
      },
    },
    state: { dayShort: "—", dayNum: "—" },
    onMount: [
      { action: "setNow", params: { paths: { "/dayShort": "dayShort", "/dayNum": "dayNum" } } },
    ],
  },
};

// open-meteo: free, no API key, permissive CORS. SF coordinates are a sensible
// default until we add a settings UI for location.
const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=37.77&longitude=-122.42" +
  "&current=temperature_2m,apparent_temperature" +
  "&daily=temperature_2m_max,temperature_2m_min" +
  "&temperature_unit=fahrenheit&timezone=auto&forecast_days=1";

const WEATHER_WIDGET: SeedDef = {
  id: "weather",
  title: "Weather",
  description: "Current temperature, feels-like, and today's high/low.",
  defaultGeometry: { x: 3, y: 0, w: 3, h: 4, minW: 2, minH: 3 },
  spec: {
    root: "card",
    elements: {
      card: { type: "Card", props: {}, children: ["stack"] },
      stack: {
        type: "Stack",
        props: { gap: "md" },
        children: ["eyebrow", "temp", "feels", "today"],
      },
      eyebrow: { type: "Text", props: { text: "WEATHER", muted: true, size: "xs" } },
      temp: {
        type: "Heading",
        props: { text: { $template: "${/temp}°F" }, level: "1" },
      },
      // Single-line templated Text instead of a label/value Row — at w=2 the
      // Row's space-between layout pushed the value into a wrap. Inlining the
      // label fits at narrow widths and matches patina's spacing well enough.
      feels: {
        type: "Text",
        props: {
          text: { $template: "Feels like ${/feelsLike}°F" },
          size: "sm",
          muted: true,
        },
      },
      today: {
        type: "Text",
        props: {
          text: { $template: "Today H ${/high}° · L ${/low}°" },
          size: "sm",
          muted: true,
        },
      },
    },
    // Empty seeds so skipIf doesn't trip on first run. The "—" fallback only
    // shows for the brief window before fetchJson resolves; templated text
    // reads "${undefined}°F" with json-render's empty-resolve behavior, which
    // is acceptable for the milliseconds it lasts.
    state: { temp: "", feelsLike: "", high: "", low: "" },
    onMount: [
      {
        action: "fetchJson",
        skipIf: "/temp",
        params: {
          url: WEATHER_URL,
          paths: {
            "/temp": "/current/temperature_2m",
            "/feelsLike": "/current/apparent_temperature",
            "/high": "/daily/temperature_2m_max/0",
            "/low": "/daily/temperature_2m_min/0",
          },
        },
      },
    ],
  },
};

const TODAY_WIDGET: SeedDef = {
  id: "today",
  title: "Today",
  description: "Short agent-generated summary of what to focus on today.",
  defaultGeometry: { x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
  spec: {
    root: "card",
    elements: {
      card: { type: "Card", props: {}, children: ["stack"] },
      stack: {
        type: "Stack",
        props: { gap: "sm" },
        children: ["eyebrow", "body"],
      },
      eyebrow: { type: "Text", props: { text: "✦ TODAY", muted: true, size: "xs" } },
      body: { type: "Markdown", props: { content: { $bindState: "/text" } } },
    },
    state: { text: "" },
    onMount: [
      {
        action: "generateText",
        // Cache across restarts — the generated paragraph is treated as the
        // morning's brief. Clear from the Widgets panel to force a refresh.
        skipIf: "/text",
        params: {
          system:
            "You are a calm, concise chief-of-staff. Reply with one short paragraph (3-4 sentences max). No markdown headers, no lists, no preamble. Speak directly to the user.",
          prompt:
            "Write a brief 'what to focus on today' note. If you don't know the user's calendar or tasks, write a generic but specific-feeling paragraph about easing into focused work this morning.",
          into: "/text",
        },
      },
    ],
  },
};

const MEETING_PREP_WIDGET: SeedDef = {
  id: "meeting-prep",
  title: "Meeting Prep",
  description: "Next meeting's title, time, and a brief prep summary.",
  defaultGeometry: { x: 0, y: 4, w: 6, h: 4, minW: 3, minH: 3 },
  spec: {
    root: "card",
    elements: {
      card: { type: "Card", props: {}, children: ["stack"] },
      stack: {
        type: "Stack",
        props: { gap: "sm" },
        children: ["eyebrow", "accent", "summary"],
      },
      eyebrow: { type: "Text", props: { text: "📅 MEETING PREP", muted: true, size: "xs" } },
      // Patina's yellow left-stripe identifies the next meeting card.
      accent: {
        type: "Accent",
        props: { color: "yellow" },
        children: ["title", "time"],
      },
      title: { type: "Heading", props: { text: { $bindState: "/title" }, level: "3" } },
      time: { type: "Text", props: { text: { $bindState: "/time" }, size: "sm", muted: true } },
      summary: {
        type: "Markdown",
        props: { content: { $bindState: "/summary" } },
      },
    },
    state: {
      title: "No upcoming meeting",
      time: "Connect Google Calendar in Extensions to populate this card.",
      summary: "",
    },
    onMount: [
      // Best-effort: ask the agent for one piece of prep advice the first
      // time the widget appears. Skips on subsequent launches so we don't
      // pay an LLM call every cold start.
      {
        action: "generateText",
        skipIf: "/summary",
        params: {
          system:
            "Concise chief-of-staff voice. 2-3 sentences. No headers. Speak directly.",
          prompt:
            "The user has no upcoming meeting connected yet. Suggest one concrete thing they could prepare for the day's first conversation, even without specifics.",
          into: "/summary",
        },
      },
    ],
  },
};

const UP_NEXT_WIDGET: SeedDef = {
  id: "up-next",
  title: "Up Next",
  description: "Timeline of upcoming events grouped by Today / Tomorrow.",
  defaultGeometry: { x: 6, y: 4, w: 6, h: 4, minW: 3, minH: 3 },
  spec: {
    root: "card",
    elements: {
      card: { type: "Card", props: {}, children: ["stack"] },
      stack: {
        type: "Stack",
        props: { gap: "md" },
        children: ["eyebrow", "emptyState", "list"],
      },
      eyebrow: { type: "Text", props: { text: "▦ UP NEXT", muted: true, size: "xs" } },
      // Static guidance shown whenever there are no events — i.e. before the
      // Google Calendar source is connected, or when the call fails. Bound to
      // the data's emptiness (`not: true`) rather than the error string so an
      // expected "source not connected" failure never paints a raw message
      // here; the callTool error still routes to /error (below), unrendered.
      emptyState: {
        type: "Text",
        props: {
          text: "Connect Google Calendar in Extensions to see your next events.",
          size: "sm",
          muted: true,
        },
        visible: { $state: "/events", not: true },
      },
      list: {
        type: "Stack",
        props: { gap: "sm" },
        repeat: { statePath: "/events", key: "id" },
        children: ["row"],
      },
      // The Calendar events.list API returns each event with `summary` and
      // a `start.dateTime` (timed events) or `start.date` (all-day). We bind
      // those raw paths into the list row; a future formatDate computed
      // function can replace the raw ISO with a friendly "2:00 PM".
      row: {
        type: "Row",
        props: {},
        children: ["accent"],
      },
      accent: {
        type: "Accent",
        props: { color: "yellow" },
        children: ["whatTitle", "whatTime"],
      },
      whatTitle: { type: "Text", props: { text: { $item: "summary" }, size: "sm" } },
      whatTime: {
        type: "Text",
        props: { text: { $item: "start/dateTime" }, size: "xs", muted: true },
      },
    },
    // No initial /events: an empty array is truthy (`Boolean([]) === true`), so
    // the `not: true` guidance check would read it as "has data" and hide the
    // prompt. Leaving it absent keeps /events falsy until a successful call
    // writes rows; the repeat reads a missing path as []. /error captures a
    // failed call (unrendered) so callTool doesn't toast on the cold-start miss.
    state: {},
    onMount: [
      // Stamp current ISO into /timeMin so the callTool input below can
      // reference it dynamically. Always re-fires (no skipIf) so the lookup
      // window stays fresh between launches.
      { action: "setNow", params: { paths: { "/timeMin": "iso" } } },
      {
        action: "callTool",
        skipIf: "/events",
        params: {
          tool: "google_calendar.events.list",
          input: {
            calendarId: "primary",
            timeMin: { $state: "/timeMin" },
            maxResults: 5,
            singleEvents: true,
            orderBy: "startTime",
          },
          select: "/items",
          into: "/events",
          error: "/error",
        },
      },
    ],
  },
};

const PEOPLE_WIDGET: SeedDef = {
  id: "people",
  title: "People",
  description: "Recent or important people to keep in touch with.",
  defaultGeometry: { x: 0, y: 8, w: 5, h: 4, minW: 3, minH: 3 },
  spec: {
    root: "card",
    elements: {
      card: { type: "Card", props: {}, children: ["stack"] },
      stack: {
        type: "Stack",
        props: { gap: "md" },
        children: ["eyebrow", "emptyState", "row"],
      },
      eyebrow: { type: "Text", props: { text: "👤 PEOPLE", muted: true, size: "xs" } },
      // Static guidance shown until contacts load (see UP_NEXT for the rationale
      // on binding to data-emptiness rather than the error string).
      emptyState: {
        type: "Text",
        props: {
          text: "Connect Google Contacts in Extensions to populate this card.",
          size: "sm",
          muted: true,
        },
        visible: { $state: "/contacts", not: true },
      },
      row: {
        type: "Row",
        props: {},
        repeat: { statePath: "/contacts", key: "resourceName" },
        children: ["avatar"],
      },
      // People API photos live at /photos/0/url; names at /names/0/displayName.
      // Until we add a photoUrl-aware Avatar branch, the fallback uses the
      // display name's leading letter via templated text.
      avatar: {
        type: "Avatar",
        props: {
          src: { $item: "photos/0/url" },
          fallback: { $item: "names/0/displayName" },
          size: "default",
        },
      },
    },
    // No initial /contacts — see UP_NEXT on why an empty array would hide the
    // guidance. /error captures a failed call (unrendered).
    state: {},
    onMount: [
      {
        action: "callTool",
        skipIf: "/contacts",
        params: {
          tool: "google_contacts.people.connections.list",
          input: {
            resourceName: "people/me",
            personFields: "names,photos,emailAddresses",
            pageSize: 8,
            sortOrder: "LAST_MODIFIED_DESCENDING",
          },
          select: "/connections",
          into: "/contacts",
          error: "/error",
        },
      },
    ],
  },
};

const TODO_WIDGET: SeedDef = {
  id: "todo",
  title: "To Do",
  description: "Local checklist — adds and persists across launches.",
  defaultGeometry: { x: 5, y: 8, w: 7, h: 4, minW: 3, minH: 3 },
  spec: {
    root: "card",
    elements: {
      card: { type: "Card", props: {}, children: ["stack"] },
      stack: { type: "Stack", props: { gap: "sm" }, children: ["eyebrow", "list"] },
      eyebrow: { type: "Text", props: { text: "☐ TO DO", muted: true, size: "xs" } },
      list: {
        type: "Stack",
        props: { gap: "sm" },
        repeat: { statePath: "/items", key: "id" },
        children: ["item"],
      },
      item: {
        type: "Checkbox",
        props: {
          label: { $item: "title" },
          checked: { $bindItem: "done" },
        },
      },
    },
    state: {
      items: [
        { id: "1", title: "Review the launch note before the afternoon sync", done: false },
        { id: "2", title: "Reply to the customer thread Patina flagged", done: false },
        { id: "3", title: "Confirm the follow-up owner for the metrics question", done: false },
      ],
    },
  },
};

const SEEDS: SeedDef[] = [
  DATE_WIDGET,
  WEATHER_WIDGET,
  TODAY_WIDGET,
  MEETING_PREP_WIDGET,
  UP_NEXT_WIDGET,
  PEOPLE_WIDGET,
  TODO_WIDGET,
];

function toDef(seed: SeedDef): JsonUiWidgetDef {
  // parseWidgetSpec canonicalizes each element (fills missing props, children,
  // visible slots) so the in-memory seed matches the on-disk-after-decode
  // shape. Without this the renderer's catalog.validate() pass rejects the
  // seed at render time with "expected nonopt input" errors — the json-render
  // spec schema requires children + visible to be present on every element.
  return {
    id: seed.id,
    title: seed.title,
    description: seed.description,
    revision: 1,
    singleton: false,
    defaultGeometry: seed.defaultGeometry,
    source: {
      kind: "json-ui",
      spec: parseWidgetSpec(seed.spec),
      createdAt: SEED_TS,
      updatedAt: SEED_TS,
    },
  };
}

function toInstance(seed: SeedDef): WidgetInstance {
  return {
    instanceId: `seed-${seed.id}`,
    widgetId: seed.id,
    placement: { surface: "pinned", geometry: { ...seed.defaultGeometry } },
    // Deep-cloned so the live store's writes never reach the persisted def's
    // initial-state template. The viewer also seeds the store from this once
    // per mount.
    state: structuredClone(seed.spec.state ?? {}),
  };
}

export const SEED_WIDGET_DEFS: JsonUiWidgetDef[] = SEEDS.map(toDef);
export const SEED_WIDGET_INSTANCES: WidgetInstance[] = SEEDS.map(toInstance);
