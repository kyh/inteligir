import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import { geometryEquals, type Widget } from "@/shared/shell";

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
 * Apply a new widget list. Skips entirely when nothing changed — e.g. a
 * re-broadcast or the post-logout invalidate echo. Otherwise reuses the prior
 * object identity for each unchanged widget so a single panel's update doesn't
 * re-render (and re-run json-render for) every sibling — only the changed ones.
 */
function applyWidgets(next: Widget[]): void {
  const current = useShellStore.getState();
  if (!current.loading) {
    if (next.length === current.widgets.length && next.every((w, i) => widgetEqual(current.widgets[i]!, w))) {
      return;
    }
  }
  const prevById = new Map(current.widgets.map((w) => [w.id, w]));
  const merged = next.map((w) => {
    const prev = prevById.get(w.id);
    return prev && widgetEqual(prev, w) ? prev : w;
  });
  useShellStore.setState({ widgets: merged, loading: false });
}

// Geometry changes don't bump updatedAt, so compare both. Chat has no content.
function widgetEqual(a: Widget, b: Widget): boolean {
  if (a.id !== b.id) return false;
  if (!geometryEquals(a.geometry, b.geometry)) return false;
  if (a.type === "spec" && b.type === "spec") return a.updatedAt === b.updatedAt;
  return true;
}
