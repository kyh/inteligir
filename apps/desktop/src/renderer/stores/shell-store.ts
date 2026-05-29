import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import type { Widget } from "@/shared/shell";

// Singleton shell store backed by one bridge subscription. Initialized lazily
// by PanelGrid on mount; the subscription lives for the session.

type ShellState = {
  widgets: Widget[];
  loading: boolean;
};

export const useShellStore = create<ShellState>(() => ({
  widgets: [],
  loading: true,
}));

let initialized = false;

export function initShell(): void {
  if (initialized) return;
  const bridge = getBridge();
  if (!bridge) return;
  initialized = true;
  let broadcastSeen = false;
  bridge.onShellUpdated((next) => {
    broadcastSeen = true;
    applyWidgets(next.widgets);
  });
  bridge
    .listShell()
    .then((next) => {
      // Skip the stale read if a broadcast with newer data has already
      // landed between subscribe and the IPC response.
      if (broadcastSeen) return null;
      applyWidgets(next.widgets);
      return null;
    })
    .catch(() => {
      if (!broadcastSeen) useShellStore.setState({ loading: false });
    });
}

/**
 * Apply a new widget list, skipping the setState (and its cascade of
 * re-renders) when the list is identical — e.g. a re-broadcast or the
 * post-logout invalidate echo. Geometry/content changes bump updatedAt or
 * differ structurally, so real changes always get through.
 */
function applyWidgets(next: Widget[]): void {
  const current = useShellStore.getState();
  if (!current.loading && sameWidgetList(current.widgets, next)) return;
  useShellStore.setState({ widgets: next, loading: false });
}

function sameWidgetList(a: Widget[], b: Widget[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id) return false;
    if (geometryChanged(x, y)) return false;
    // Artifact content bumps updatedAt; chat has no content to compare.
    if (x.type === "artifact" && y.type === "artifact" && x.updatedAt !== y.updatedAt) {
      return false;
    }
  }
  return true;
}

function geometryChanged(a: Widget, b: Widget): boolean {
  const g = a.geometry;
  const h = b.geometry;
  return g.x !== h.x || g.y !== h.y || g.w !== h.w || g.h !== h.h;
}
