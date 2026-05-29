import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import { geometryEquals, type CustomWidgetDef, type WidgetInstance } from "@/shared/shell";

// Singleton shell store backed by one bridge subscription. Initialized lazily
// by PanelGrid on mount; the subscription lives for the session.

type ShellState = {
  customWidgets: CustomWidgetDef[];
  instances: WidgetInstance[];
  loading: boolean;
};

export const useShellStore = create<ShellState>(() => ({
  customWidgets: [],
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
    apply(next.customWidgets, next.instances);
  });
  bridge
    .listShell()
    .then((next) => {
      // Skip the stale read if a broadcast with newer data already landed.
      if (broadcastSeen) return null;
      apply(next.customWidgets, next.instances);
      return null;
    })
    .catch(() => {
      if (!broadcastSeen) useShellStore.setState({ loading: false });
    });
}

/**
 * Apply a new snapshot, reusing the prior object identity for each unchanged
 * definition and instance so a single change re-renders only the affected
 * panel(s) — not every sibling viewer.
 */
function apply(customWidgets: CustomWidgetDef[], instances: WidgetInstance[]): void {
  const prev = useShellStore.getState();
  const defs = reconcile(prev.customWidgets, customWidgets, (a, b) => a.updatedAt === b.updatedAt, (d) => d.id);
  const insts = reconcile(prev.instances, instances, instanceEqual, (i) => i.instanceId);
  if (!prev.loading && defs === prev.customWidgets && insts === prev.instances) return;
  useShellStore.setState({ customWidgets: defs, instances: insts, loading: false });
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

function instanceEqual(a: WidgetInstance, b: WidgetInstance): boolean {
  // state crosses IPC as a fresh object each broadcast, so compare by value.
  return (
    a.widgetId === b.widgetId &&
    geometryEquals(a.geometry, b.geometry) &&
    jsonEqual(a.state, b.state)
  );
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
