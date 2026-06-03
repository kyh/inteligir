import { BrowserWindow } from "electron";

import { IPC, type IpcEvent, type IpcMethod } from "@/shared/ipc-registry";

type EventMethod = {
  [K in IpcMethod]: (typeof IPC)[K] extends { kind: "event" } ? K : never;
}[IpcMethod];

/**
 * Broadcast an event-kind IPC entry to every renderer window. The method's
 * channel + payload type are resolved from the registry, so a renamed event
 * channel is a compile error here.
 */
export function broadcast<K extends EventMethod>(method: K, data: IpcEvent<K>): void {
  const def = IPC[method];
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(def.channel, data);
    }
  }
}

/**
 * Targeted send. Same registry-keyed contract as broadcast(); used when a
 * round-trip protocol (e.g. flush request → ack) needs to address one
 * window's webContents id from a tracked set.
 */
export function sendToWindow<K extends EventMethod>(
  webContents: Electron.WebContents,
  method: K,
  data: IpcEvent<K>,
): void {
  const def = IPC[method];
  webContents.send(def.channel, data);
}
