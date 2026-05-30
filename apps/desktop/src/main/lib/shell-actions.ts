// Destructive ShellManager actions wrapped with a pre-step that flushes the
// renderer's pending widget state. Both the IPC handler surface and the
// agent's manage_ui tool route through these — keeping mgr.* synchronous and
// unit-testable while ensuring no caller can drop in-flight edits.

import { flushRendererInstance } from "@/main/lib/widget-flush";
import { getShell } from "@/main/shell";
import type { WidgetInstance, WidgetSurface } from "@/shared/shell";

/** Unplace one instance after flushing its pending state to main. */
export async function unplaceWithFlush(instanceId: string): Promise<boolean> {
  await flushRendererInstance(instanceId);
  return getShell().unplaceWidget(instanceId);
}

/** Place an instance of a widget after flushing pending state for any live
 * instance of the same widget. An existing singleton can be surface-switched
 * by placeWidget (pinned ↔ floating on a dock click, or explicitly to either)
 * which unmounts the old WidgetViewer and seeds a new one from the broadcast
 * instance.state — without the flush, edits from the last debounce window
 * are dropped from the UI and the archive. Flushing instances whose surface
 * doesn't actually change is a clean no-op. */
export async function placeWithFlush(
  widgetId: string,
  surface?: WidgetSurface,
): Promise<WidgetInstance | null> {
  const mgr = getShell();
  const live = mgr.snapshot().instances.filter((i) => i.widgetId === widgetId);
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
