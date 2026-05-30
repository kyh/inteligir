import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import {
  geometryEquals,
  rectEquals,
  type WidgetDef,
  type WidgetInstance,
} from "@/shared/shell";

// Singleton shell store backed by one bridge subscription. Initialized lazily
// by PanelGrid on mount; the subscription lives for the session.

type ShellState = {
  defs: WidgetDef[];
  instances: WidgetInstance[];
  loading: boolean;
};

export const useShellStore = create<ShellState>(() => ({
  defs: [],
  instances: [],
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
    apply(next.defs, next.instances);
  });

  // Retry on failure so a transient IPC hiccup doesn't leave the workspace
  // stuck at empty defs/instances. A broadcast (which can land any time after
  // the subscription above is wired) also satisfies the load.
  const RETRY_DELAYS_MS = [200, 500, 1000];
  let attempt = 0;
  const fetchOnce = (): void => {
    bridge
      .listShell()
      .then((next) => {
        if (!broadcastSeen) apply(next.defs, next.instances);
      })
      .catch(() => {
        if (broadcastSeen) return;
        const delay = RETRY_DELAYS_MS[attempt++];
        if (delay !== undefined) setTimeout(fetchOnce, delay);
        else useShellStore.setState({ loading: false });
      });
  };
  fetchOnce();
}

/**
 * Apply a new snapshot, reusing the prior object identity for each unchanged
 * def and instance so a single change re-renders only the affected panel(s)
 * — not every sibling viewer.
 */
function apply(defs: WidgetDef[], instances: WidgetInstance[]): void {
  const prev = useShellStore.getState();
  const nextDefs = reconcile(prev.defs, defs, defEqual, (d) => d.id);
  const nextInstances = reconcile(prev.instances, instances, instanceEqual, (i) => i.instanceId);
  if (!prev.loading && nextDefs === prev.defs && nextInstances === prev.instances) return;
  useShellStore.setState({ defs: nextDefs, instances: nextInstances, loading: false });
}

// Returns `prev` unchanged (same array ref) when nothing differs; otherwise a
// new array reusing prior element identities where equal.
function reconcile<T>(prev: T[], next: T[], equal: (a: T, b: T) => boolean, key: (v: T) => string): T[] {
  if (prev.length === next.length) {
    let same = true;
    for (let i = 0; i < next.length; i++) {
      if (key(prev[i]!) !== key(next[i]!) || !equal(prev[i]!, next[i]!)) {
        same = false;
        break;
      }
    }
    if (same) return prev;
  }
  const prevByKey = new Map(prev.map((v) => [key(v), v]));
  return next.map((v) => {
    const old = prevByKey.get(key(v));
    return old && equal(old, v) ? old : v;
  });
}

function defEqual(a: WidgetDef, b: WidgetDef): boolean {
  if (a.id !== b.id || a.title !== b.title) return false;
  if (a.source.kind !== b.source.kind) return false;
  // Built-ins are code-defined and reference-equal forever; customs bump
  // updatedAt on any content change.
  if (a.source.kind === "custom" && b.source.kind === "custom") {
    return a.source.updatedAt === b.source.updatedAt;
  }
  return true;
}

function instanceEqual(a: WidgetInstance, b: WidgetInstance): boolean {
  if (a.widgetId !== b.widgetId) return false;
  if (a.placement.surface !== b.placement.surface) return false;
  if (a.placement.surface === "pinned" && b.placement.surface === "pinned") {
    if (!geometryEquals(a.placement.geometry, b.placement.geometry)) return false;
  } else if (a.placement.surface === "floating" && b.placement.surface === "floating") {
    if (a.placement.z !== b.placement.z) return false;
    if (!rectEquals(a.placement.rect, b.placement.rect)) return false;
  }
  return jsonEqual(a.state, b.state);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
