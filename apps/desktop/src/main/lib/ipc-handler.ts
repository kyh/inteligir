// ---------------------------------------------------------------------------
// Typed IPC handler registration. Every handler is keyed by a method name in
// the shared IPC registry; the channel + payload schema + result type are
// looked up from the registry, so a single hand-written string can never
// drift from the bridge type or the handler signature.
// ---------------------------------------------------------------------------

import { ipcMain } from "electron";

import { IPC, type IpcHandler, type IpcMethod } from "@/shared/ipc-registry";

export function handle<K extends IpcMethod>(method: K, fn: IpcHandler<K>): void {
  const def = IPC[method];
  switch (def.kind) {
    case "invoke":
      ipcMain.handle(def.channel, (_event, raw: unknown) => {
        const payload = def.payload.parse(raw);
        return (fn as (p: unknown) => unknown)(payload);
      });
      return;
    case "invoke-void":
      ipcMain.handle(def.channel, () => (fn as () => unknown)());
      return;
    case "send":
      ipcMain.on(def.channel, (_event, raw: unknown) => {
        try {
          const payload = def.payload.parse(raw);
          (fn as (p: unknown) => void)(payload);
        } catch (err) {
          console.error(`[ipc] send handler "${method}" failed:`, err);
        }
      });
      return;
    case "event":
      throw new Error(`Method "${method}" is event-only (main → renderer); use broadcast() instead`);
  }
}
