// ShellManager actions that must flush renderer-owned widget state before
// changing placement or lifetime. IPC handlers and the agent's manage_ui tool
// route through these; ShellManager stays synchronous and unit-testable.

import { flushRendererInstance } from "@/main/lib/widget-flush";
import { getShell } from "@/main/shell";
import type { WidgetInstance, WidgetSurface } from "@/shared/shell";

/** Unplace one instance after flushing its pending state to main. */
export async function unplaceWithFlush(instanceId: string): Promise<boolean> {
  await flushRendererInstance(instanceId);
  return getShell().unplaceWidget(instanceId);
}

/** Place an instance of a widget after flushing pending state for any live
 * singleton instance of the same widget. Generated widgets can have many
 * sibling instances, and placing a new sibling does not remount existing
 * viewers. Singletons can surface-switch or focus in place, so their current
 * viewer must flush before the broadcast seeds a replacement mount. */
export async function placeWithFlush(
  widgetId: string,
  surface?: WidgetSurface,
): Promise<WidgetInstance | null> {
  const mgr = getShell();
  const def = mgr.getDef(widgetId);
  const live = def?.singleton
    ? mgr.snapshot().instances.filter((i) => i.widgetId === widgetId)
    : [];
  await Promise.all(live.map((i) => flushRendererInstance(i.instanceId)));
  return mgr.placeWidget(widgetId, surface);
}

/** Delete a custom widget after flushing every live instance of it.
 * The flushed state is discarded with the def — but waiting prevents the
 * post-delete unmount-time setInstanceState from firing against a removed
 * instance, and ensures the archive (if anything writes one) reflects the
 * latest edits. */
export async function deleteWithFlush(
  widgetId: string,
  expectedRevision?: number,
): Promise<boolean> {
  const mgr = getShell();
  const live = mgr.snapshot().instances.filter((i) => i.widgetId === widgetId);
  await Promise.all(live.map((i) => flushRendererInstance(i.instanceId)));
  return mgr.deleteWidget(widgetId, expectedRevision);
}
