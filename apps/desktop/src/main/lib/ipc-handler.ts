// ---------------------------------------------------------------------------
// Typed IPC handler registration. Every handler is keyed by a method name in
// the shared IPC registry; the channel + payload schema + result type are
// looked up from the registry, so a single hand-written string can never
// drift from the bridge type or the handler signature.
// ---------------------------------------------------------------------------

import { ipcMain } from "electron";
import { Value } from "@sinclair/typebox/value";

import { IPC, type IpcHandler, type IpcMethod } from "@/shared/ipc-registry";

function parsePayload(method: IpcMethod, schema: unknown, raw: unknown): unknown {
  if (!Value.Check(schema as Parameters<typeof Value.Check>[0], raw)) {
    const first = Value.Errors(
      schema as Parameters<typeof Value.Errors>[0],
      raw,
    ).First();
    const detail = first ? `${first.path || "/"}: ${first.message}` : "shape mismatch";
    throw new Error(`[ipc:${method}] payload validation failed — ${detail}`);
  }
  return raw;
}

export function handle<K extends IpcMethod>(method: K, fn: IpcHandler<K>): void {
  const def = IPC[method];
  switch (def.kind) {
    case "invoke":
      ipcMain.handle(def.channel, (_event, raw: unknown) => {
        const payload = parsePayload(method, def.payload, raw);
        return (fn as (p: unknown) => unknown)(payload);
      });
      return;
    case "invoke-void":
      ipcMain.handle(def.channel, () => (fn as () => unknown)());
      return;
    case "send":
      ipcMain.on(def.channel, (_event, raw: unknown) => {
        try {
          const payload = parsePayload(method, def.payload, raw);
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
