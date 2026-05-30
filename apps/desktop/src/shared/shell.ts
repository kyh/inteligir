// Runtime UI kernel model. The shell is only one surface over this model.
//
//  - Widget definitions ("what's installed"): every widget, system or
//    generated, is a WidgetDef. Built-ins render through React components;
//    generated widgets render through json-render specs.
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
import type { ActionBinding, UIElement, VisibilityCondition } from "@json-render/core";

// ---------------------------------------------------------------------------
// json-render spec — generated widget rendering
// ---------------------------------------------------------------------------

export type JsonWidgetComponentType =
  | "Stack"
  | "Section"
  | "Row"
  | "Heading"
  | "Text"
  | "TextBlock"
  | "Button"
  | "Checkbox"
  | "Input"
  | "Textarea"
  | "Card"
  | "Separator";

export type WidgetActionName =
  | "notify"
  | "openUrl"
  | "sendPrompt"
  | "generateText"
  | "fetchUrl"
  | "setState";

export type WidgetActionRequest = ActionBinding & { action: WidgetActionName };

export type WidgetSpecElement = UIElement<JsonWidgetComponentType, Record<string, unknown>> & {
  type: JsonWidgetComponentType;
  props: Record<string, unknown>;
  children?: string[];
  visible?: VisibilityCondition;
  on?: Record<string, WidgetActionRequest | WidgetActionRequest[]>;
  watch?: Record<string, WidgetActionRequest | WidgetActionRequest[]>;
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

export const WIDGET_DEFAULT_SIZE: Pick<WidgetGeometry, "w" | "h" | "minW" | "minH"> = {
  w: 7,
  h: 6,
  minW: 2,
  minH: 3,
};

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

export type WidgetSource =
  | { kind: "builtin-react" }
  | {
      kind: "json-ui";
      spec: WidgetSpec;
      createdAt: number;
      updatedAt: number;
    };

/** A widget definition. Built-ins live in code (BUILTIN_DEFS); customs are
 * agent-/user-generated and persisted alongside instances. */
export type BaseWidgetDef = {
  id: string;
  title: string;
  description?: string;
  /** Monotonic def revision. Agent writes can target the version they read. */
  revision: number;
  /** At most one instance can be placed at a time. */
  singleton: boolean;
  /** The seeded instance can't be removed. Implies singleton. */
  permanent: boolean;
  /** Initial grid placement for new instances. */
  defaultGeometry: WidgetGeometry;
  source: WidgetSource;
};

export type BuiltinWidgetId = "chat" | "tasks" | "skills" | "extensions" | "settings";

export type BuiltinWidgetDef = BaseWidgetDef & {
  id: BuiltinWidgetId;
  singleton: true;
  source: { kind: "builtin-react" };
};

export type JsonUiWidgetDef = BaseWidgetDef & {
  singleton: false;
  permanent: false;
  source: Extract<WidgetSource, { kind: "json-ui" }>;
};

export type WidgetDef = BuiltinWidgetDef | JsonUiWidgetDef;

// Keyed by id so the metadata is exhaustive over BuiltinWidgetId — adding an
// id is a compile error until both this map and the renderer's
// BUILTIN_WIDGET_UI (also keyed by the union) are filled in.
const BUILTIN_DEFS_BY_ID: Record<BuiltinWidgetId, BuiltinWidgetDef> = {
  chat: {
    id: "chat",
    title: "Conversation",
    revision: 1,
    singleton: true,
    permanent: true,
    defaultGeometry: { x: 0, y: 0, w: 5, h: 12, minW: 3, minH: 5 },
    source: { kind: "builtin-react" },
  },
  tasks: {
    id: "tasks",
    title: "Tasks",
    revision: 1,
    singleton: true,
    permanent: false,
    defaultGeometry: { x: 5, y: 0, w: 4, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin-react" },
  },
  skills: {
    id: "skills",
    title: "Skills",
    revision: 1,
    singleton: true,
    permanent: false,
    defaultGeometry: { x: 9, y: 0, w: 3, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin-react" },
  },
  extensions: {
    id: "extensions",
    title: "Extensions",
    revision: 1,
    singleton: true,
    permanent: false,
    defaultGeometry: { x: 5, y: 6, w: 4, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin-react" },
  },
  settings: {
    id: "settings",
    title: "Settings",
    revision: 1,
    singleton: true,
    permanent: false,
    defaultGeometry: { x: 9, y: 6, w: 3, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin-react" },
  },
};

export const BUILTIN_DEFS: BuiltinWidgetDef[] = Object.values(BUILTIN_DEFS_BY_ID);

export const CHAT_WIDGET_ID = "chat";

export function isBuiltinWidgetId(id: string): id is BuiltinWidgetId {
  return (
    id === "chat" || id === "tasks" || id === "skills" || id === "extensions" || id === "settings"
  );
}

export function builtinDef(id: string): BuiltinWidgetDef | undefined {
  return isBuiltinWidgetId(id) ? BUILTIN_DEFS_BY_ID[id] : undefined;
}

export function isBuiltin(def: WidgetDef): def is BuiltinWidgetDef {
  return def.source.kind === "builtin-react";
}

export function isJsonUi(def: WidgetDef): def is JsonUiWidgetDef {
  return def.source.kind === "json-ui";
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

/** Persisted: only the custom defs (built-ins live in code) + every instance,
 * plus a per-widgetId archive of state we last saw before an instance was
 * unplaced — so toggling a widget off and on doesn't wipe what the user typed. */
export type Shell = {
  version: 2;
  customDefs: JsonUiWidgetDef[];
  instances: WidgetInstance[];
  archivedStates: Record<string, Record<string, unknown>>;
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

export type InstallWidgetInput = {
  id?: string;
  title: string;
  description?: string;
  spec: WidgetSpec;
  state?: Record<string, unknown>;
};

export type UpdateWidgetInput = {
  id: string;
  expectedRevision: number;
  title?: string;
  description?: string;
  spec: WidgetSpec;
};

export type WidgetPatchInput = {
  id: string;
  expectedRevision: number;
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
