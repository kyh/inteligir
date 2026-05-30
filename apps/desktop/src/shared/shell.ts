// The shell is an OS-like workspace. Two concepts:
//
//  - Widget definitions ("what's installed"): every widget — preinstalled and
//    agent-/user-generated — is a WidgetDef. They differ only in `source`:
//    a built-in widget renders via a React component registered in code
//    (`source.kind === "builtin"`); a custom widget renders a json-render spec
//    persisted on disk (`source.kind === "custom"`).
//
//  - Instances ("what's open"): a WidgetInstance is one placement of a def,
//    either pinned to the desktop grid or floating as a window. A def can be
//    placed zero, one, or many times.
//
//  - The dock is the gallery/launcher for placing defs; the workspace shows
//    placed instances (pinned on the grid; floating in a layer above).
//
// Types stay loose here so main/preload don't pull @json-render/core in.

import type { JsonPatchOp } from "./json-pointer";

// ---------------------------------------------------------------------------
// json-render spec — the rendering of a "custom" widget def
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
// Geometry + rect
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

/** Free-form pixel rect for a floating (window) placement. */
export type FloatRect = { x: number; y: number; width: number; height: number };

export const WIDGET_DEFAULT_RECT: FloatRect = { x: 340, y: 96, width: 380, height: 440 };

export function geometryEquals(a: WidgetGeometry, b: WidgetGeometry): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function rectEquals(a: FloatRect, b: FloatRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// ---------------------------------------------------------------------------
// Widget definitions — "what's installed"
// ---------------------------------------------------------------------------

/** Where a def's rendering comes from. */
export type WidgetSource =
  | { kind: "builtin" }
  | { kind: "custom"; spec: WidgetSpec; createdAt: number; updatedAt: number };

/** A widget definition. Built-ins live in code (BUILTIN_DEFS); customs are
 * agent-/user-generated and persisted alongside instances. */
export type WidgetDef = {
  id: string;
  title: string;
  description?: string;
  /** At most one instance can be placed at a time. */
  singleton: boolean;
  /** The seeded instance can't be removed. Implies singleton. */
  permanent: boolean;
  /** Initial grid placement for new instances. */
  defaultGeometry: WidgetGeometry;
  source: WidgetSource;
};

export type BuiltinWidgetId = "chat" | "tasks" | "skills" | "extensions" | "settings";

// Keyed by id so the metadata is exhaustive over BuiltinWidgetId — adding an
// id is a compile error until both this map and the renderer's
// BUILTIN_WIDGET_UI (also keyed by the union) are filled in.
const BUILTIN_DEFS_BY_ID: Record<BuiltinWidgetId, WidgetDef> = {
  chat: {
    id: "chat", title: "Conversation", singleton: true, permanent: true,
    defaultGeometry: { x: 0, y: 0, w: 5, h: 12, minW: 3, minH: 5 },
    source: { kind: "builtin" },
  },
  tasks: {
    id: "tasks", title: "Tasks", singleton: true, permanent: false,
    defaultGeometry: { x: 5, y: 0, w: 4, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin" },
  },
  skills: {
    id: "skills", title: "Skills", singleton: true, permanent: false,
    defaultGeometry: { x: 9, y: 0, w: 3, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin" },
  },
  extensions: {
    id: "extensions", title: "Extensions", singleton: true, permanent: false,
    defaultGeometry: { x: 5, y: 6, w: 4, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin" },
  },
  settings: {
    id: "settings", title: "Settings", singleton: true, permanent: false,
    defaultGeometry: { x: 9, y: 6, w: 3, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin" },
  },
};

export const BUILTIN_DEFS: WidgetDef[] = Object.values(BUILTIN_DEFS_BY_ID);

export const CHAT_WIDGET_ID = "chat";

export function builtinDef(id: string): WidgetDef | undefined {
  return (BUILTIN_DEFS_BY_ID as Record<string, WidgetDef | undefined>)[id];
}

export function isBuiltin(def: WidgetDef): boolean {
  return def.source.kind === "builtin";
}

export function isCustom(def: WidgetDef): boolean {
  return def.source.kind === "custom";
}

// ---------------------------------------------------------------------------
// Instances — "what's open"
// ---------------------------------------------------------------------------

/** Where an instance is shown: "pinned" to the desktop grid (a "desktop
 * widget") or "floating" above everything (an "app window"). */
export type WidgetSurface = "pinned" | "floating";

/** Placement is a discriminated union — pinned instances carry grid
 * coordinates only; floating instances carry a free-form rect and z-order
 * only. Toggling surfaces drops to the target surface's defaults. */
export type Placement =
  | { surface: "pinned"; geometry: WidgetGeometry }
  | { surface: "floating"; rect: FloatRect; z: number };

export type WidgetInstance = {
  instanceId: string;
  /** Matches a BUILTIN_DEFS id or a persisted custom WidgetDef id. */
  widgetId: string;
  placement: Placement;
  /** Per-instance bound state (custom widgets; built-ins manage their own). */
  state: Record<string, unknown>;
};

export type PinnedInstance = WidgetInstance & {
  placement: Extract<Placement, { surface: "pinned" }>;
};

export type FloatingInstance = WidgetInstance & {
  placement: Extract<Placement, { surface: "floating" }>;
};

export function isPinned(i: WidgetInstance): i is PinnedInstance {
  return i.placement.surface === "pinned";
}

export function isFloating(i: WidgetInstance): i is FloatingInstance {
  return i.placement.surface === "floating";
}

// ---------------------------------------------------------------------------
// Shell — what's persisted, what the renderer/agent see
// ---------------------------------------------------------------------------

/** Persisted: only the custom defs (built-ins live in code) + every instance. */
export type Shell = {
  version: 1;
  customDefs: WidgetDef[];
  instances: WidgetInstance[];
};

/** Broadcast to the renderer + returned from listShell: every def the agent or
 * UI can act on (built-in + custom) and every placed instance. */
export type ShellSnapshot = {
  defs: WidgetDef[];
  instances: WidgetInstance[];
};

// ---------------------------------------------------------------------------
// Agent / IPC inputs
// ---------------------------------------------------------------------------

export type CreateWidgetInput = {
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
