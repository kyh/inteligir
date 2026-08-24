// The renderer's only bridge, and it is one value.
//
// FIXED VERBS, never a channel name: nothing here takes a channel, a path or
// anything else the renderer chooses — the page can ask for exactly what this
// module already decided to expose. The value itself is read once at load
// through a synchronous invoke, because the renderer needs it before it opens
// its first socket.

import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, socketOriginSchema } from "../types";
import type { DesktopBridge } from "../types";

const socketOrigin = socketOriginSchema.parse(ipcRenderer.sendSync(IPC_CHANNELS.SOCKET_ORIGIN));

contextBridge.exposeInMainWorld("desktopBridge", { socketOrigin } satisfies DesktopBridge);
