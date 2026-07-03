// ---------------------------------------------------------------------------
// Fold the host's validated handler map into Electron IPC, and forward host
// events to every renderer window. The UPDATE_METHODS trio is NOT part of
// host.handlers — updater.ts registers those itself (electron-updater is a
// shell concern).
// ---------------------------------------------------------------------------

import { BrowserWindow, ipcMain } from "electron";

import type { Host } from "@repo/host/create-host";
import { HOST_METHODS } from "@repo/host/lib/handler-registry";
import { IPC } from "@repo/features/ipc-registry";

export function sendToAllWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

export function foldHostIntoIpc(host: Host): void {
  for (const method of HOST_METHODS) {
    const def = IPC[method];
    const handler = host.handlers[method];
    if (def.kind === "send") {
      ipcMain.on(def.channel, (_event, raw: unknown) => handler(raw));
    } else {
      ipcMain.handle(def.channel, (_event, raw: unknown) => handler(raw));
    }
  }

  host.events.onAny((method, payload) => {
    sendToAllWindows(IPC[method].channel, payload);
  });
}
