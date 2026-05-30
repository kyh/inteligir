import { z } from "zod";

import { deleteWithFlush, unplaceWithFlush } from "@/main/lib/shell-actions";
import { createIpcHandler, createVoidIpcHandler } from "@/main/lib/ipc-handler";
import { GeometrySchema, getShell, InstallWidgetInputSchema, RectSchema } from "@/main/shell";
import { IPC_CHANNELS } from "@/shared/ipc";

export function registerShellIpcHandlers(): void {
  createVoidIpcHandler(IPC_CHANNELS.SHELL_LIST, () => getShell().snapshot());

  createIpcHandler(IPC_CHANNELS.SHELL_INSTALL, InstallWidgetInputSchema, (input) =>
    getShell().installWidget(input),
  );

  createIpcHandler(
    IPC_CHANNELS.SHELL_PLACE,
    z.object({ widgetId: z.string().min(1), surface: z.enum(["pinned", "floating"]).optional() }),
    ({ widgetId, surface }) => getShell().placeWidget(widgetId, surface),
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
      getShell().setGeometries(geometries);
    },
  );

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_RECT,
    z.object({ instanceId: z.string().min(1), rect: RectSchema }),
    ({ instanceId, rect }) => {
      getShell().setRect(instanceId, rect);
    },
  );

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_SURFACE,
    z.object({ instanceId: z.string().min(1), surface: z.enum(["pinned", "floating"]) }),
    ({ instanceId, surface }) => getShell().setSurface(instanceId, surface),
  );

  createIpcHandler(IPC_CHANNELS.SHELL_FOCUS, z.string().min(1), (instanceId) => {
    getShell().bringToFront(instanceId);
  });

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_STATE,
    z.object({ instanceId: z.string().min(1), state: z.record(z.string(), z.unknown()) }),
    ({ instanceId, state }) => getShell().setInstanceState(instanceId, state),
  );
}
