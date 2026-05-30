// A tiny per-instanceId registry so surface-change and unplace paths can wait
// for the active viewer's pending debounced state to flush to main before
// initiating the IPC that will remount or destroy the viewer.
//
// Without this, a pop-out / close clicked within the debounce window races
// the unmount-time flush: main processes the surface change first, broadcasts
// the now-stale instance.state, and the freshly-mounted viewer seeds from it.
// The user's last keystrokes are lost from the visible UI even though they
// eventually land on disk.

const flushers = new Map<string, () => Promise<void>>();

/** Register a flush for an instance; returns an unregister fn. Only the
 * most-recently-registered flush wins — exactly one viewer is mounted per
 * instanceId at a time. */
export function registerInstanceFlush(
  instanceId: string,
  fn: () => Promise<void>,
): () => void {
  flushers.set(instanceId, fn);
  return () => {
    if (flushers.get(instanceId) === fn) flushers.delete(instanceId);
  };
}

/** Force any pending state changes for an instance to reach main before
 * resolving. Safe to call when no viewer is mounted (resolves immediately). */
export async function flushInstanceState(instanceId: string): Promise<void> {
  await flushers.get(instanceId)?.();
}
