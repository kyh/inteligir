import { z } from "zod";

import { deleteWithFlush, placeWithFlush, unplaceWithFlush } from "@/main/lib/shell-actions";
import { createIpcHandler, createVoidIpcHandler } from "@/main/lib/ipc-handler";
import {
  GeometrySchema,
  InstallWidgetInputSchema,
  RectSchema,
  SurfaceSchema,
} from "@/main/shell-schema";
import { getShellSnapshot, getWritableShell } from "@/main/shell";
import { IPC_CHANNELS } from "@/shared/ipc";

export function registerShellIpcHandlers(): void {
  createVoidIpcHandler(IPC_CHANNELS.SHELL_LIST, () => {
    return getShellSnapshot();
  });

  createIpcHandler(IPC_CHANNELS.SHELL_INSTALL, InstallWidgetInputSchema, (input) => {
    const shell = getWritableShell();
    if (!shell) throw new Error("Shell not ready");
    return shell.installWidget(input);
  });

  createIpcHandler(
    IPC_CHANNELS.SHELL_PLACE,
    z.object({ widgetId: z.string().min(1), surface: SurfaceSchema.optional() }),
    ({ widgetId, surface }) => {
      return placeWithFlush(widgetId, surface);
    },
  );

  createIpcHandler(IPC_CHANNELS.SHELL_UNPLACE, z.string().min(1), async (instanceId) => {
    return { removed: await unplaceWithFlush(instanceId) };
  });

  createIpcHandler(
    IPC_CHANNELS.SHELL_DELETE,
    z.object({
      widgetId: z.string().min(1),
      expectedRevision: z.number().int().positive().optional(),
    }),
    async ({ widgetId, expectedRevision }) => {
      return { deleted: await deleteWithFlush(widgetId, expectedRevision) };
    },
  );

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_GEOMETRY,
    z.record(z.string(), GeometrySchema),
    (geometries) => {
      getWritableShell()?.setGeometries(geometries);
    },
  );

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_RECT,
    z.object({ instanceId: z.string().min(1), rect: RectSchema }),
    ({ instanceId, rect }) => {
      getWritableShell()?.setRect(instanceId, rect);
    },
  );

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_SURFACE,
    z.object({ instanceId: z.string().min(1), surface: SurfaceSchema }),
    ({ instanceId, surface }) => {
      return getWritableShell()?.setSurface(instanceId, surface) ?? null;
    },
  );

  createIpcHandler(IPC_CHANNELS.SHELL_FOCUS, z.string().min(1), (instanceId) => {
    getWritableShell()?.bringToFront(instanceId);
  });

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_STATE,
    z.object({ instanceId: z.string().min(1), state: z.record(z.string(), z.unknown()) }),
    ({ instanceId, state }) => {
      // Reject when writes are suspended (post-logout) instead of silently
      // returning null: the renderer's flushPersist would otherwise see a
      // resolved invoke, report persisted=true to the flush bridge, and let
      // unplace/delete proceed even though the state never reached disk.
      const shell = getWritableShell();
      if (!shell) throw new Error("Shell not ready");
      return shell.setInstanceState(instanceId, state);
    },
  );
}
