// ShellManager actions that must flush renderer-owned widget state before
// changing placement or lifetime. IPC handlers and the agent's manage_ui tool
// route through these; ShellManager stays synchronous and unit-testable.
//
// A failed flush throws (rather than returning a falsy result) so callers can
// surface a real error to the user / agent — falsy is reserved for "shell is
// suspended" or "widget not found", which the caller's not-found branch
// handles differently from a flush failure.

import { flushRendererInstance } from "@/main/lib/widget-flush";
import { getWritableShell } from "@/main/shell";
import type { WidgetInstance, WidgetSurface } from "@/shared/shell";

class FlushFailedError extends Error {
  constructor(message = "Renderer flush did not persist pending state") {
    super(message);
    this.name = "FlushFailedError";
  }
}

/** Unplace one instance after flushing its pending state to main. Throws
 * FlushFailedError when the renderer couldn't persist; returns false when
 * the shell is suspended. */
export async function unplaceWithFlush(instanceId: string): Promise<boolean> {
  const mgr = getWritableShell();
  if (!mgr) return false;
  if (!(await flushRendererInstance(instanceId))) throw new FlushFailedError();
  return mgr.unplaceWidget(instanceId);
}

/** Place an instance of a widget after flushing pending state for any live
 * singleton instance of the same widget. Generated widgets can have many
 * sibling instances, and placing a new sibling does not remount existing
 * viewers. Singletons can surface-switch or focus in place, so their current
 * viewer must flush before the broadcast seeds a replacement mount. Throws
 * FlushFailedError on a quiet renderer failure; returns null when the shell
 * is suspended or the widget doesn't exist. */
export async function placeWithFlush(
  widgetId: string,
  surface?: WidgetSurface,
): Promise<WidgetInstance | null> {
  const mgr = getWritableShell();
  if (!mgr) return null;
  const def = mgr.getDef(widgetId);
  const live = def?.singleton
    ? mgr.snapshot().instances.filter((i) => i.widgetId === widgetId)
    : [];
  if (!(await flushInstances(live))) throw new FlushFailedError();
  return mgr.placeWidget(widgetId, surface);
}

/** Delete a custom widget after flushing every live instance of it.
 * The flushed state is discarded with the def — but waiting prevents the
 * post-delete unmount-time setInstanceState from firing against a removed
 * instance, and ensures the archive (if anything writes one) reflects the
 * latest edits. Throws FlushFailedError on a quiet renderer failure;
 * returns false when the shell is suspended or the widget doesn't exist. */
export async function deleteWithFlush(
  widgetId: string,
  expectedRevision?: number,
): Promise<boolean> {
  const mgr = getWritableShell();
  if (!mgr) return false;
  const live = mgr.snapshot().instances.filter((i) => i.widgetId === widgetId);
  if (!(await flushInstances(live))) throw new FlushFailedError();
  return mgr.deleteWidget(widgetId, expectedRevision);
}

async function flushInstances(instances: WidgetInstance[]): Promise<boolean> {
  const results = await Promise.all(instances.map((i) => flushRendererInstance(i.instanceId)));
  return results.every(Boolean);
}
