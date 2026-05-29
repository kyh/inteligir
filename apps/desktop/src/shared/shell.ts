// The shell is an OS-like workspace. Three concepts:
//
//  - Widget definitions ("what exists"): built-in widgets are code-defined
//    (a React component, listed in BUILTIN_WIDGETS); custom widgets are
//    agent-/user-generated json-render specs (CustomWidgetDef, persisted).
//  - Instances ("what's placed"): a WidgetInstance is one placement of a
//    definition on the grid, with its own id, geometry, and bound state. A
//    definition can be placed zero, one, or many times.
//  - The dock is the gallery/launcher for placing definitions; the grid shows
//    the placed instances.
//
// Types stay loose here so main/preload don't pull @json-render/core in.

import type { JsonPatchOp } from "./json-pointer";

// ---------------------------------------------------------------------------
// json-render spec (a custom widget definition's rendering)
// ---------------------------------------------------------------------------

export type WidgetSpecElement = {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
  visible?: unknown;
  on?: Record<string, unknown>;
  watch?: Record<string, unknown>;
};

export type WidgetSpec = {
  root: string;
  elements: Record<string, WidgetSpecElement>;
  state?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type WidgetGeometry = {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

export const WIDGET_DEFAULT_SIZE = { w: 7, h: 6, minW: 2, minH: 3 } as const;

export function geometryEquals(a: WidgetGeometry, b: WidgetGeometry): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

// ---------------------------------------------------------------------------
// Definitions — "what exists"
// ---------------------------------------------------------------------------

export type BuiltinWidgetId = "chat" | "tasks" | "skills" | "extensions" | "settings";

/** Metadata for a code-defined widget. The React component + icon live in the
 * renderer's built-in registry, keyed by `id`; this metadata is shared so main
 * (the agent tool) and the renderer agree on what's available. */
export type BuiltinWidgetMeta = {
  id: BuiltinWidgetId;
  title: string;
  /** At most one instance can be placed. */
  singleton: boolean;
  /** The seeded instance can't be removed (chat). Implies singleton. */
  permanent: boolean;
  defaultGeometry: WidgetGeometry;
};

export const BUILTIN_WIDGETS: BuiltinWidgetMeta[] = [
  { id: "chat", title: "Conversation", singleton: true, permanent: true, defaultGeometry: { x: 0, y: 0, w: 5, h: 12, minW: 3, minH: 5 } },
  { id: "tasks", title: "Tasks", singleton: true, permanent: false, defaultGeometry: { x: 5, y: 0, w: 4, h: 6, minW: 2, minH: 3 } },
  { id: "skills", title: "Skills", singleton: true, permanent: false, defaultGeometry: { x: 9, y: 0, w: 3, h: 6, minW: 2, minH: 3 } },
  { id: "extensions", title: "Extensions", singleton: true, permanent: false, defaultGeometry: { x: 5, y: 6, w: 4, h: 6, minW: 2, minH: 3 } },
  { id: "settings", title: "Settings", singleton: true, permanent: false, defaultGeometry: { x: 9, y: 6, w: 3, h: 6, minW: 2, minH: 3 } },
];

export const CHAT_WIDGET_ID = "chat";

export function builtinMeta(id: string): BuiltinWidgetMeta | undefined {
  return BUILTIN_WIDGETS.find((b) => b.id === id);
}

/** A generated widget definition — rendered from a json-render spec. */
export type CustomWidgetDef = {
  id: string;
  title: string;
  description?: string;
  spec: WidgetSpec;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Instances — "what's placed"
// ---------------------------------------------------------------------------

export type WidgetInstance = {
  instanceId: string;
  /** BuiltinWidgetId or a CustomWidgetDef.id. */
  widgetId: string;
  geometry: WidgetGeometry;
  /** Per-instance bound state (custom widgets; built-ins manage their own). */
  state: Record<string, unknown>;
};

export type Shell = {
  version: 1;
  customWidgets: CustomWidgetDef[];
  instances: WidgetInstance[];
};

/** What the renderer + agent see (built-ins come from BUILTIN_WIDGETS). */
export type ShellSnapshot = {
  customWidgets: CustomWidgetDef[];
  instances: WidgetInstance[];
};

// ---------------------------------------------------------------------------
// Agent / IPC inputs
// ---------------------------------------------------------------------------

export type GenerateWidgetInput = {
  id?: string;
  title: string;
  description?: string;
  spec: WidgetSpec;
  state?: Record<string, unknown>;
};

export type WidgetPatchInput = {
  id: string;
  ops: JsonPatchOp[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Order matters: strip → slice → strip again. The slice can land mid-run and
// reintroduce a trailing hyphen.
export function slugifyWidgetId(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "widget";
}
