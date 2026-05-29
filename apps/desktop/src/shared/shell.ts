// The shell is the reshapeable workspace: a flat list of widgets, each with a
// grid geometry. Two widget types — the permanent `chat` widget, and `spec`
// widgets (agent-/user-authored json-render UI the agent creates/patches and
// the user reshapes/removes). Types stay loose here so main/preload don't pull
// @json-render/core in.

import type { JsonPatchOp } from "./json-pointer";

// Shape mirrors json-render's `Spec` so the renderer hands it to <Renderer />
// without conversion.
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

export type WidgetGeometry = {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

type WidgetBase = {
  id: string;
  geometry: WidgetGeometry;
};

/** The conversation surface. Pinned: movable/resizable but never removable. */
export type ChatWidget = WidgetBase & {
  id: typeof CHAT_WIDGET_ID;
  type: "chat";
};

/** A widget whose content is an agent-/user-authored json-render spec. */
export type SpecWidget = WidgetBase & {
  type: "spec";
  title: string;
  description?: string;
  spec: WidgetSpec;
  state: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type Widget = ChatWidget | SpecWidget;

export type Shell = {
  version: 1;
  widgets: Widget[];
};

export type ShellList = {
  widgets: Widget[];
};

export type WidgetUpsertInput = {
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

export const CHAT_WIDGET_ID = "chat";

const CHAT_GEOMETRY: WidgetGeometry = { x: 0, y: 0, w: 5, h: 12, minW: 3, minH: 5 };
export const WIDGET_DEFAULT_SIZE = { w: 7, h: 6, minW: 2, minH: 3 } as const;

export function defaultChatWidget(): ChatWidget {
  return { id: CHAT_WIDGET_ID, type: "chat", geometry: { ...CHAT_GEOMETRY } };
}

export function isSpecWidget(w: Widget): w is SpecWidget {
  return w.type === "spec";
}

/** Layout-only equality (x/y/w/h) — geometry changes don't bump updatedAt, so
 * both the main store and the renderer dedup on this. */
export function geometryEquals(a: WidgetGeometry, b: WidgetGeometry): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

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
