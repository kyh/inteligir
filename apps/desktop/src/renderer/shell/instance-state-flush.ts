// A tiny per-instanceId registry so surface-change and unplace paths can wait
// for the active viewer's pending debounced state to flush to main before
// initiating the IPC that will remount or destroy the viewer.
//
// Without this, a pop-out / close clicked within the debounce window races
// the unmount-time flush: main processes the surface change first, broadcasts
// the now-stale instance.state, and the freshly-mounted viewer seeds from it.
// The user's last keystrokes are lost from the visible UI even though they
// eventually land on disk.

import { getBridge } from "@/renderer/lib/bridge";

const flushers = new Map<string, () => Promise<boolean>>();
let bridgeSubscribed = false;

/** Register a flush for an instance; returns an unregister fn. Only the
 * most-recently-registered flush wins — exactly one viewer is mounted per
 * instanceId at a time. The fn resolves true on success (or "nothing pending")
 * and false when state was pending but couldn't be persisted. */
export function registerInstanceFlush(
  instanceId: string,
  fn: () => Promise<boolean>,
): () => void {
  flushers.set(instanceId, fn);
  return () => {
    if (flushers.get(instanceId) === fn) flushers.delete(instanceId);
  };
}

/** Force any pending state changes for an instance to reach main before
 * resolving. Returns whether the flush actually persisted (or there was
 * nothing to flush). Returns true when no viewer is mounted — no pending
 * state, nothing to persist. */
export async function flushInstanceState(instanceId: string): Promise<boolean> {
  const fn = flushers.get(instanceId);
  if (!fn) return true;
  return fn();
}

/** Subscribe to main-initiated flush requests so a main-side caller (e.g. the
 * agent's manage_ui unplace) can wait for the renderer's pending state to
 * land before transitioning the instance. Idempotent — safe to call from any
 * mount. The ack carries whether the flush actually succeeded so main can
 * distinguish "flushed" from "tried but failed" instead of proceeding blind. */
export function initFlushBridge(): void {
  if (bridgeSubscribed) return;
  const bridge = getBridge();
  if (!bridge) return;
  bridgeSubscribed = true;
  bridge.onWidgetFlushRequest(async ({ instanceId, requestId }) => {
    const persisted = await flushInstanceState(instanceId);
    bridge.ackWidgetFlush({ requestId, persisted });
  });
}
