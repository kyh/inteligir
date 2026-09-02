// read synchronously at load: the renderer needs the origin before it opens its first socket.

import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, socketOriginSchema } from "../types";
import type { DesktopBridge } from "../types";

const socketOrigin = socketOriginSchema.parse(ipcRenderer.sendSync(IPC_CHANNELS.SOCKET_ORIGIN));

contextBridge.exposeInMainWorld("desktopBridge", { socketOrigin } satisfies DesktopBridge);
