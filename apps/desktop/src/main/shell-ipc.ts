import { deleteWithFlush, placeWithFlush, unplaceWithFlush } from "@/main/lib/shell-actions";
import { handle } from "@/main/lib/ipc-handler";
import { getShellSnapshot, getWritableShell } from "@/main/shell";

export function registerShellIpcHandlers(): void {
  handle("listShell", () => getShellSnapshot());

  handle("installWidget", (input) => {
    const shell = getWritableShell();
    if (!shell) throw new Error("Shell not ready");
    return shell.installWidget(input);
  });

  handle("placeWidget", ({ widgetId, surface }) => placeWithFlush(widgetId, surface));

  handle("unplaceWidget", async (instanceId) => ({
    removed: await unplaceWithFlush(instanceId),
  }));

  handle("deleteWidget", async ({ widgetId, expectedRevision }) => ({
    deleted: await deleteWithFlush(widgetId, expectedRevision),
  }));

  handle("setInstanceGeometry", (geometries) => {
    getWritableShell()?.setGeometries(geometries);
  });

  handle("setInstanceRect", ({ instanceId, rect }) => {
    getWritableShell()?.setRect(instanceId, rect);
  });

  handle("setInstanceSurface", ({ instanceId, surface }) => {
    return getWritableShell()?.setSurface(instanceId, surface) ?? null;
  });

  handle("focusInstance", (instanceId) => {
    getWritableShell()?.bringToFront(instanceId);
  });

  handle("setInstanceState", ({ instanceId, state }) => {
    // Reject when writes are suspended (post-logout) instead of silently
    // returning null: the renderer's flushPersist would otherwise see a
    // resolved invoke, report persisted=true to the flush bridge, and let
    // unplace/delete proceed even though the state never reached disk.
    const shell = getWritableShell();
    if (!shell) throw new Error("Shell not ready");
    return shell.setInstanceState(instanceId, state);
  });
}
