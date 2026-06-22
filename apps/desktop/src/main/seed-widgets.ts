// Default dashboard widgets seeded on first run. Most are json-ui specs
// rendered through WidgetViewer; onMount actions populate their state live
// (no user click required) from local time, open-meteo, the agent, or the
// user's connected integrations. The Agenda and To-Do cards are built-in
// React widgets (BUILTIN_DEFS) seeded onto the grid as instances — the
// unified Agenda replaces the old static Meeting Prep / Up Next cards, and
// the interactive To-Do panel replaces the old static checklist.
//
// Layout occupies the full 12-column grid (chat is launched from the dock,
// not pre-placed):
//   y=0  Date(3) Weather(3) Today(6)
//   y=4  Agenda(6, tall)    People(6)
//   y=8                     To Do(6)

import {
  builtinDef,
  type JsonUiWidgetDef,
  type WidgetGeometry,
  type WidgetInstance,
} from "@/shared/shell";
import { parseWidgetSpec, type WidgetSpec } from "@/shared/widget-spec";

// Stable timestamp for seed defs — Date.now() at seed time would mark every
// fresh install as "updated now", breaking equality comparisons in tests and
// pushing a meaningless updatedAt forward on every launch.
const SEED_TS = 0;

type SeedDef = {
  id: string;
  title: string;
  description: string;
  defaultGeometry: WidgetGeometry;
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

const PEOPLE_WIDGET: SeedDef = {
  id: "people",
  title: "People",
  description: "Recent or important people to keep in touch with.",
  defaultGeometry: { x: 6, y: 4, w: 6, h: 4, minW: 3, minH: 3 },
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
          // See UP_NEXT for the address shape. The Discovery method id for the
          // People API is "people.people.connections.list" (api-name prefix).
          tool: "google_contacts.user.default.people.people.connections.list",
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

const SEEDS: SeedDef[] = [DATE_WIDGET, WEATHER_WIDGET, TODAY_WIDGET, PEOPLE_WIDGET];

// Built-in React widgets pinned onto the dashboard by default. Their defs live
// in BUILTIN_DEFS (shell.ts) and are already in every snapshot; here we only
// place an instance on the grid. The geometry below overrides each def's
// defaultGeometry for the seeded placement.
const BUILTIN_SEED_PLACEMENTS: { widgetId: string; geometry: WidgetGeometry }[] = [
  { widgetId: "agenda", geometry: { x: 0, y: 4, w: 6, h: 8, minW: 3, minH: 4 } },
  { widgetId: "todos", geometry: { x: 6, y: 8, w: 6, h: 4, minW: 2, minH: 3 } },
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

// A pinned grid instance of a built-in widget. Built-ins manage their own
// state (not the json-render store), so the instance state is empty. Validates
// the id against BUILTIN_DEFS so a typo fails loudly at module load rather than
// rendering a blank slot.
function toBuiltinInstance(placement: {
  widgetId: string;
  geometry: WidgetGeometry;
}): WidgetInstance {
  if (!builtinDef(placement.widgetId)) {
    throw new Error(`Unknown built-in widget seeded onto the grid: ${placement.widgetId}`);
  }
  return {
    instanceId: `seed-${placement.widgetId}`,
    widgetId: placement.widgetId,
    placement: { surface: "pinned", geometry: { ...placement.geometry } },
    state: {},
  };
}

export const SEED_WIDGET_DEFS: JsonUiWidgetDef[] = SEEDS.map(toDef);
export const SEED_WIDGET_INSTANCES: WidgetInstance[] = [
  ...SEEDS.map(toInstance),
  ...BUILTIN_SEED_PLACEMENTS.map(toBuiltinInstance),
];
