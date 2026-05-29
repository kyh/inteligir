// The shell is the reshapeable workspace: a flat list of widgets, each with a
// grid geometry. The chat widget is permanent (always present, never
// removable); artifact widgets are agent-/user-authored json-render panels.
// Types stay loose here so main/preload don't pull @json-render/core in.

import type { Artifact } from "./artifacts";

export type WidgetGeometry = {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

/** The conversation surface. Pinned: movable/resizable but never removable. */
export type ChatWidget = {
  id: typeof CHAT_WIDGET_ID;
  type: "chat";
  geometry: WidgetGeometry;
};

/** An agent- or user-authored json-render panel placed in the workspace. */
export type ArtifactWidget = Artifact & {
  type: "artifact";
  geometry: WidgetGeometry;
};

export type Widget = ChatWidget | ArtifactWidget;

export type Shell = {
  version: 1;
  widgets: Widget[];
};

export const CHAT_WIDGET_ID = "chat";

export const CHAT_GEOMETRY: WidgetGeometry = { x: 0, y: 0, w: 5, h: 12, minW: 3, minH: 5 };
export const ARTIFACT_DEFAULT_SIZE = { w: 7, h: 6, minW: 2, minH: 3 } as const;

export function defaultChatWidget(): ChatWidget {
  return { id: CHAT_WIDGET_ID, type: "chat", geometry: { ...CHAT_GEOMETRY } };
}

export function isArtifactWidget(w: Widget): w is ArtifactWidget {
  return w.type === "artifact";
}

/** Permanent widgets can't be removed by the user or the agent. */
export function isPermanentWidget(w: Widget): boolean {
  return w.type === "chat";
}

export type ShellList = {
  widgets: Widget[];
};

// Re-export the artifact authoring types — an artifact widget's payload is an
// Artifact, so the agent tool + IPC reuse these.
export type {
  Artifact,
  ArtifactSpec,
  ArtifactUpsertInput,
  ArtifactPatchInput,
  ArtifactPatchOp,
} from "./artifacts";
