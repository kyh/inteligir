import { z } from "zod";

import { deleteWithFlush, placeWithFlush, unplaceWithFlush } from "@/main/lib/shell-actions";
import { createIpcHandler, createVoidIpcHandler } from "@/main/lib/ipc-handler";
import { GeometrySchema, InstallWidgetInputSchema, RectSchema } from "@/main/shell-schema";
import { getShell, isShellWritable } from "@/main/shell";
import { IPC_CHANNELS } from "@/shared/ipc";

export function registerShellIpcHandlers(): void {
  createVoidIpcHandler(IPC_CHANNELS.SHELL_LIST, () => getShell().snapshot());

  createIpcHandler(IPC_CHANNELS.SHELL_INSTALL, InstallWidgetInputSchema, (input) => {
    if (!isShellWritable()) throw new Error("Shell not ready");
    return getShell().installWidget(input);
  });

  createIpcHandler(
    IPC_CHANNELS.SHELL_PLACE,
    z.object({ widgetId: z.string().min(1), surface: z.enum(["pinned", "floating"]).optional() }),
    ({ widgetId, surface }) => {
      if (!isShellWritable()) return null;
      return placeWithFlush(widgetId, surface);
    },
  );

  createIpcHandler(IPC_CHANNELS.SHELL_UNPLACE, z.string().min(1), async (instanceId) => {
    if (!isShellWritable()) return { removed: false };
    return { removed: await unplaceWithFlush(instanceId) };
  });

  createIpcHandler(
    IPC_CHANNELS.SHELL_DELETE,
    z.object({
      widgetId: z.string().min(1),
      expectedRevision: z.number().int().positive().optional(),
    }),
    async ({ widgetId, expectedRevision }) => {
      if (!isShellWritable()) return { deleted: false };
      return { deleted: await deleteWithFlush(widgetId, expectedRevision) };
    },
  );

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_GEOMETRY,
    z.record(z.string(), GeometrySchema),
    (geometries) => {
      if (!isShellWritable()) return;
      getShell().setGeometries(geometries);
    },
  );

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_RECT,
    z.object({ instanceId: z.string().min(1), rect: RectSchema }),
    ({ instanceId, rect }) => {
      if (!isShellWritable()) return;
      getShell().setRect(instanceId, rect);
    },
  );

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_SURFACE,
    z.object({ instanceId: z.string().min(1), surface: z.enum(["pinned", "floating"]) }),
    ({ instanceId, surface }) => {
      if (!isShellWritable()) return null;
      return getShell().setSurface(instanceId, surface);
    },
  );

  createIpcHandler(IPC_CHANNELS.SHELL_FOCUS, z.string().min(1), (instanceId) => {
    if (!isShellWritable()) return;
    getShell().bringToFront(instanceId);
  });

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_STATE,
    z.object({ instanceId: z.string().min(1), state: z.record(z.string(), z.unknown()) }),
    ({ instanceId, state }) => {
      if (!isShellWritable()) return null;
      return getShell().setInstanceState(instanceId, state);
    },
  );
}
