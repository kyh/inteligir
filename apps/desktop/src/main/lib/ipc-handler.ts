// ---------------------------------------------------------------------------
// Typed IPC handler registration. Every handler is keyed by a method name in
// the shared IPC registry; the channel + payload schema + result type are
// looked up from the registry, so a single hand-written string can never
// drift from the bridge type or the handler signature.
// ---------------------------------------------------------------------------

import { ipcMain } from "electron";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { IPC, type IpcHandler, type IpcMethod } from "@repo/core/ipc-registry";

function parsePayload(method: IpcMethod, schema: TSchema, raw: unknown): unknown {
  if (!Value.Check(schema, raw)) {
    const first = Value.Errors(schema, raw).First();
    const detail = first ? `${first.path || "/"}: ${first.message}` : "shape mismatch";
    throw new Error(`[ipc:${method}] payload validation failed — ${detail}`);
  }
  return raw;
}

// The `fn as ...` casts below are the classic correlated-union limitation
// (microsoft/TypeScript#30581): narrowing `def.kind` cannot narrow the
// generic `IpcHandler<K>`, so each branch widens `fn` to its runtime shape.
// Soundness is carried by the registry: `def.kind` and `IpcHandler<K>` are
// derived from the same entry, and payloads are schema-validated first.
export function handle<K extends IpcMethod>(method: K, fn: IpcHandler<K>): void {
  const def = IPC[method];
  switch (def.kind) {
    case "invoke":
      ipcMain.handle(def.channel, (_event, raw: unknown) => {
        const payload = parsePayload(method, def.payload, raw);
        // oxlint-disable-next-line typescript/consistent-type-assertions -- correlated union, see doc above
        return (fn as (p: unknown) => unknown)(payload);
      });
      return;
    case "invoke-void":
      // oxlint-disable-next-line typescript/consistent-type-assertions -- correlated union, see doc above
      ipcMain.handle(def.channel, () => (fn as () => unknown)());
      return;
    case "send":
      ipcMain.on(def.channel, (_event, raw: unknown) => {
        try {
          const payload = parsePayload(method, def.payload, raw);
          // oxlint-disable-next-line typescript/consistent-type-assertions -- correlated union, see doc above
          (fn as (p: unknown) => void)(payload);
        } catch (err) {
          console.error(`[ipc] send handler "${method}" failed:`, err);
        }
      });
      return;
    case "event":
      throw new Error(
        `Method "${method}" is event-only (main → renderer); use emitEvent() instead`,
      );
  }
}
