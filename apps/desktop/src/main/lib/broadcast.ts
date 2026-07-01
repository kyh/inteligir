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
