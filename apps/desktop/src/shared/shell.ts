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
// Persisted shapes are defined once as TypeBox schemas here, with the TS
// types derived via Static — main/shell-schema.ts instantiates the same
// schemas for the on-disk file, so the disk schema can't drift from these
// types.

import { type Static, type TSchema, Type } from "@sinclair/typebox";

import type { JsonPatchOp } from "./json-pointer";
import { WidgetSpecParam } from "./widget-spec";

// ---------------------------------------------------------------------------
// Geometry + rect
// ---------------------------------------------------------------------------

export const WidgetGeometrySchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    w: Type.Number(),
    h: Type.Number(),
    minW: Type.Optional(Type.Number()),
    minH: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

export type WidgetGeometry = Static<typeof WidgetGeometrySchema>;

export const WIDGET_DEFAULT_SIZE: Pick<WidgetGeometry, "w" | "h" | "minW" | "minH"> = {
  w: 7,
  h: 6,
  minW: 2,
  minH: 3,
};

/** Free-form pixel rect for a floating (window) placement. */
export const FloatRectSchema = Type.Object(
  { x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() },
  { additionalProperties: false },
);

export type FloatRect = Static<typeof FloatRectSchema>;

export const WIDGET_DEFAULT_RECT: FloatRect = { x: 340, y: 96, width: 380, height: 440 };

export function geometryEquals(a: WidgetGeometry, b: WidgetGeometry): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    a.minW === b.minW &&
    a.minH === b.minH
  );
}

export function rectEquals(a: FloatRect, b: FloatRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// ---------------------------------------------------------------------------
// Widget definitions — "what's installed"
// ---------------------------------------------------------------------------

/** A custom widget definition. Built-ins live in code (BUILTIN_DEFS); customs
 * are agent-/user-generated and persisted alongside instances.
 *
 * One field list, parameterised over the spec schema: the persisted shell
 * (main/shell-schema.ts) keeps `spec` as Unknown so one malformed spec on
 * disk routes through decode/corrupt-recovery instead of rejecting the whole
 * shell, while the in-memory JsonUiWidgetDef binds the parsed WidgetSpec. */
function jsonUiWidgetDefSchema<S extends TSchema>(specSchema: S) {
  return Type.Object(
    {
      id: Type.String(),
      title: Type.String(),
      description: Type.Optional(Type.String()),
      // Monotonic def revision. Agent writes can target the version they read.
      revision: Type.Number(),
      // Custom defs are always multi-instance; only built-ins are singletons.
      singleton: Type.Literal(false),
      // Initial grid placement for new instances.
      defaultGeometry: WidgetGeometrySchema,
      source: Type.Object(
        {
          kind: Type.Literal("json-ui"),
          spec: specSchema,
          createdAt: Type.Number(),
          updatedAt: Type.Number(),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  );
}

const JsonUiWidgetDefSchema = jsonUiWidgetDefSchema(WidgetSpecParam);

export type JsonUiWidgetDef = Static<typeof JsonUiWidgetDefSchema>;

/** Def fields shared with built-ins — the canonical field list lives in
 * jsonUiWidgetDefSchema; built-ins only override what differs. */
type BaseWidgetDef = Omit<JsonUiWidgetDef, "singleton" | "source">;

function tuple<const T extends readonly string[]>(...values: T): T {
  return values;
}

const BUILTIN_WIDGET_IDS = tuple("chat", "widgets", "tasks", "extensions", "settings");

export type BuiltinWidgetId = (typeof BUILTIN_WIDGET_IDS)[number];

export type BuiltinWidgetDef = BaseWidgetDef & {
  id: BuiltinWidgetId;
  /** At most one instance can be placed at a time. */
  singleton: true;
  source: { kind: "builtin-react" };
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
    defaultGeometry: { x: 0, y: 0, w: 5, h: 12, minW: 3, minH: 5 },
    source: { kind: "builtin-react" },
  },
  widgets: {
    id: "widgets",
    title: "Widgets",
    revision: 1,
    singleton: true,
    defaultGeometry: { x: 5, y: 0, w: 4, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin-react" },
  },
  tasks: {
    id: "tasks",
    title: "Scheduled Tasks",
    revision: 1,
    singleton: true,
    defaultGeometry: { x: 9, y: 0, w: 3, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin-react" },
  },
  extensions: {
    id: "extensions",
    title: "Extensions",
    revision: 1,
    singleton: true,
    defaultGeometry: { x: 5, y: 6, w: 4, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin-react" },
  },
  settings: {
    id: "settings",
    title: "Settings",
    revision: 1,
    singleton: true,
    defaultGeometry: { x: 9, y: 6, w: 3, h: 6, minW: 2, minH: 3 },
    source: { kind: "builtin-react" },
  },
};

export const BUILTIN_DEFS: BuiltinWidgetDef[] = Object.values(BUILTIN_DEFS_BY_ID);

export const CHAT_WIDGET_ID = "chat";

function isBuiltinWidgetId(id: string): id is BuiltinWidgetId {
  return BUILTIN_WIDGET_IDS.some((candidate) => candidate === id);
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
export const WIDGET_SURFACES = tuple("pinned", "floating");
export type WidgetSurface = (typeof WIDGET_SURFACES)[number];

/** Placement is a discriminated union — pinned instances carry grid
 * coordinates only; floating instances carry a free-form rect and z-order
 * only. Toggling surfaces drops to the target surface's defaults. */
const PlacementSchema = Type.Union([
  Type.Object(
    { surface: Type.Literal("pinned"), geometry: WidgetGeometrySchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { surface: Type.Literal("floating"), rect: FloatRectSchema, z: Type.Number() },
    { additionalProperties: false },
  ),
]);

export type Placement = Static<typeof PlacementSchema>;

const WidgetInstanceSchema = Type.Object(
  {
    instanceId: Type.String(),
    // Matches a BUILTIN_DEFS id or a persisted custom WidgetDef id.
    widgetId: Type.String(),
    placement: PlacementSchema,
    // Per-instance bound state (custom widgets; built-ins manage their own).
    state: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

export type WidgetInstance = Static<typeof WidgetInstanceSchema>;

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
 * unplaced — so toggling a widget off and on doesn't wipe what the user typed.
 *
 * Parameterised over the custom-def spec schema for the same disk/memory
 * split as jsonUiWidgetDefSchema: main/shell-schema.ts instantiates this with
 * Unknown for the on-disk file; the Shell type binds the parsed WidgetSpec. */
export function shellSchema<S extends TSchema>(specSchema: S) {
  return Type.Object(
    {
      version: Type.Literal(2),
      customDefs: Type.Array(jsonUiWidgetDefSchema(specSchema)),
      instances: Type.Array(WidgetInstanceSchema),
      archivedStates: Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
    },
    { additionalProperties: false },
  );
}

const MemoryShellSchema = shellSchema(WidgetSpecParam);

export type Shell = Static<typeof MemoryShellSchema>;

/** Broadcast to the renderer + returned from listShell: every def the agent or
 * UI can act on (built-in + custom) and every placed instance. */
export type ShellSnapshot = {
  defs: WidgetDef[];
  instances: WidgetInstance[];
};

// ---------------------------------------------------------------------------
// Agent / IPC inputs
// ---------------------------------------------------------------------------

// Inputs cross the IPC boundary, so `spec` arrives as `unknown` — the
// receiver runs parseWidgetSpec to deep-validate before persisting.
export type InstallWidgetInput = {
  id?: string | undefined;
  title: string;
  description?: string | undefined;
  spec: unknown;
};

export type UpdateWidgetInput = {
  id: string;
  expectedRevision: number;
  title?: string | undefined;
  description?: string | undefined;
  spec: unknown;
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
