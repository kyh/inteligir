// read synchronously at load: the renderer needs the origin before it opens its first socket.

import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, socketOriginSchema } from "../types";
import type { DesktopBridge } from "../types";
import { updateStateSchema, type UpdateState } from "../update-state";

const socketOrigin = socketOriginSchema.parse(ipcRenderer.sendSync(IPC_CHANNELS.SOCKET_ORIGIN));

// the IPC boundary: every frame is parsed here, so the page only ever sees the state it knows
async function invokeForState(channel: string): Promise<UpdateState> {
  return updateStateSchema.parse(await ipcRenderer.invoke(channel));
}

const updates: DesktopBridge["updates"] = {
  getState: () => invokeForState(IPC_CHANNELS.UPDATE_GET_STATE),
  check: () => invokeForState(IPC_CHANNELS.UPDATE_CHECK),
  download: () => invokeForState(IPC_CHANNELS.UPDATE_DOWNLOAD),
  install: () => invokeForState(IPC_CHANNELS.UPDATE_INSTALL),
  onState: (listener) => {
    // typed by electron's own listener signature, so the frame is parsed, never declared
    const relay: Parameters<typeof ipcRenderer.on>[1] = (_event, frame) => {
      const parsed = updateStateSchema.safeParse(frame);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC_CHANNELS.UPDATE_STATE, relay);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATE, relay);
    };
  },
};

contextBridge.exposeInMainWorld("desktopBridge", { socketOrigin, updates } satisfies DesktopBridge);
