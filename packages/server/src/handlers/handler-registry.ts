// ---------------------------------------------------------------------------
// Typed handler collection. Every host handler is keyed by a method name in
// the shared IPC registry; the payload schema + result type are looked up
// from the registry, so a hand-written string can never drift from the
// Bridge type or the handler signature. Payloads are validated HERE — the
// transport (the ws host) passes raw wire values straight in and gets
// identical validation.
// ---------------------------------------------------------------------------

import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  DESKTOP_SHELL_METHODS,
  IPC,
  IPC_METHODS,
  type HostMethod,
  type IpcHandler,
  type IpcMethod,
} from "@repo/bridge/ipc-registry";

// Methods the desktop SHELL implements (not the platform-agnostic host): the
// html-app token mint/revoke. Excluded from HOST_METHODS.
const shellMethods = new Set<string>(DESKTOP_SHELL_METHODS);

function isHostMethod(method: IpcMethod): method is HostMethod {
  return IPC[method].kind !== "event" && !shellMethods.has(method);
}

/** Every method the host must implement, as a runtime list. */
export const HOST_METHODS: readonly HostMethod[] = IPC_METHODS.filter(isHostMethod);

/** A wire-facing handler: takes the raw transport payload (validated inside),
 * returns the result (or a promise of it); send-kind handlers return void. */
export type WireHandler = (raw: unknown) => unknown;

export type HostHandlers = Readonly<Record<HostMethod, WireHandler>>;

/** The registration callback handler groups receive — same call shape as the
 * old desktop `handle("method", fn)`. */
export type HandlerRegistrar = <K extends HostMethod>(method: K, fn: IpcHandler<K>) => void;

function parsePayload(method: IpcMethod, schema: TSchema, raw: unknown): unknown {
  if (!Value.Check(schema, raw)) {
    const first = Value.Errors(schema, raw).First();
    const detail = first ? `${first.path || "/"}: ${first.message}` : "shape mismatch";
    throw new Error(`[ipc:${method}] payload validation failed — ${detail}`);
  }
  return raw;
}

// The `invoke-void` branch below casts `fn` to its runtime shape: that is the
// classic correlated-union limitation (microsoft/TypeScript#30581) — narrowing
// `def.kind` cannot narrow the generic `IpcHandler<K>`, and the arity differs
// from the payload-taking branches, which call `fn` directly. Soundness is
// carried by the registry: `def.kind` and `IpcHandler<K>` are derived from the
// same entry, and payloads are schema-validated first.

/**
 * Run every handler group against a fresh registrar and return the complete,
 * validated handler map. Throws on a duplicate registration and on any
 * registry method left unhandled — a missing handler is a dead Bridge method
 * (the UI's invoke would hang), so boot fails loudly instead.
 */
export function collectHandlers(register: (handle: HandlerRegistrar) => void): HostHandlers {
  const map = new Map<HostMethod, WireHandler>();

  const handle: HandlerRegistrar = (method, fn) => {
    if (map.has(method)) throw new Error(`duplicate host handler for "${method}"`);
    const def = IPC[method];
    switch (def.kind) {
      case "invoke":
        map.set(method, (raw) => {
          const payload = parsePayload(method, def.payload, raw);
          return fn(payload);
        });
        return;
      case "invoke-void":
        // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- correlated union, see doc above
        map.set(method, () => (fn as () => unknown)());
        return;
      case "send":
        map.set(method, (raw) => {
          // Fire-and-forget channel — a throw would otherwise escape to the
          // transport's event loop, so swallow + log.
          try {
            const payload = parsePayload(method, def.payload, raw);
            fn(payload);
          } catch (err) {
            console.error(`[ipc] send handler "${method}" failed:`, err);
          }
        });
        return;
    }
  };

  register(handle);

  const missing = HOST_METHODS.filter((method) => !map.has(method));
  if (missing.length > 0) {
    throw new Error(`host handlers missing for: ${missing.join(", ")}`);
  }
  const handlers: Partial<Record<HostMethod, WireHandler>> = {};
  for (const [method, handler] of map) handlers[method] = handler;
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- completeness proven by the missing-check above
  return handlers as HostHandlers;
}
