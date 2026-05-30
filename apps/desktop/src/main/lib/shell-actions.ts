// Destructive ShellManager actions wrapped with a pre-step that flushes the
// renderer's pending widget state. Both the IPC handler surface and the
// agent's manage_ui tool route through these — keeping mgr.* synchronous and
// unit-testable while ensuring no caller can drop in-flight edits.

import { flushRendererInstance } from "@/main/lib/widget-flush";
import { getShell } from "@/main/shell";

/** Unplace one instance after flushing its pending state to main. */
export async function unplaceWithFlush(instanceId: string): Promise<boolean> {
  await flushRendererInstance(instanceId);
  return getShell().unplaceWidget(instanceId);
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
