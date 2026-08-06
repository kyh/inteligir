// ---------------------------------------------------------------------------
// Typed handler collection for the cloud host.
//
// The node host has the same fold, and this is deliberately not a copy that
// drifts: both derive the REQUIRED SET from `@repo/bridge/ipc-registry`, which
// is the single source of truth, so a channel added there fails BOTH hosts'
// boot until it is answered. It cannot be shared as code — `@repo/server`
// reaches node through half its dependency graph and cannot be imported on
// workerd.
//
// Payloads are validated HERE, against the registry's own TypeBox schema, so
// the transport passes raw wire values straight in and every host validates
// identically.
// ---------------------------------------------------------------------------

import {
  DESKTOP_SHELL_METHODS,
  IPC,
  IPC_METHODS,
  type HostMethod,
  type IpcHandler,
  type IpcMethod,
} from "@repo/bridge/ipc-registry";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// The html-app token mint/revoke touch the Electron main process's token store,
// so no non-desktop host owns them.
const shellMethods = new Set<string>(DESKTOP_SHELL_METHODS);

function isHostMethod(method: IpcMethod): method is HostMethod {
  return IPC[method].kind !== "event" && !shellMethods.has(method);
}

/** Every method a host must implement, as a runtime list. */
export const HOST_METHODS: readonly HostMethod[] = IPC_METHODS.filter(isHostMethod);

/** A wire-facing handler: takes the raw transport payload (validated inside)
 * and returns the result, or a promise of it; send-kind handlers return void. */
export type WireHandler = (raw: unknown) => unknown;

type HostHandlers = Readonly<Record<HostMethod, WireHandler>>;

/** The registration callback handler groups receive. */
export type HandlerRegistrar = <K extends HostMethod>(method: K, fn: IpcHandler<K>) => void;

/**
 * Register `method` as present-but-unimplemented: it answers by throwing a
 * message naming `feature`.
 *
 * A shim is a first-class registration rather than a handler that happens to
 * throw, because a method with no backend has no payload contract to validate
 * and no result type to honour — only a gap to name. It is deliberately NOT a
 * silent `[]` or `undefined`: a caller cannot tell an empty vault from an
 * absent one, so a plausible answer renders a confidently wrong world where a
 * throw names itself in the res frame.
 */
export type ShimRegistrar = (method: HostMethod, feature: string) => void;

/** The one refusal an unimplemented capability answers with — the single
 * message format, so every gap reads the same in a res frame and in a log. */
export function unavailable(feature: string): never {
  throw new Error(`${feature} is not available on the cloud host yet`);
}

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
 * validated handler map. Throws on a duplicate registration and on any registry
 * method left unhandled — an unanswered method is a Bridge call that hangs
 * forever, so construction fails loudly instead.
 */
export function collectHandlers(
  register: (handle: HandlerRegistrar, shim: ShimRegistrar) => void,
): HostHandlers {
  const map = new Map<HostMethod, WireHandler>();

  const claim = (method: HostMethod, handler: WireHandler): void => {
    if (map.has(method)) throw new Error(`duplicate host handler for "${method}"`);
    map.set(method, handler);
  };

  const handle: HandlerRegistrar = (method, fn) => {
    const def = IPC[method];
    switch (def.kind) {
      case "invoke":
        claim(method, (raw) => {
          const payload = parsePayload(method, def.payload, raw);
          return fn(payload);
        });
        return;
      case "invoke-void":
        // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- correlated union, see doc above
        claim(method, () => (fn as () => unknown)());
        return;
      case "send":
        claim(method, (raw) => {
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

  const shim: ShimRegistrar = (method, feature) => {
    claim(method, () => unavailable(feature));
  };

  register(handle, shim);

  const missing = HOST_METHODS.filter((method) => !map.has(method));
  if (missing.length > 0) {
    throw new Error(`host handlers missing for: ${missing.join(", ")}`);
  }
  const handlers: Partial<Record<HostMethod, WireHandler>> = {};
  for (const [method, handler] of map) handlers[method] = handler;
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- completeness proven by the missing-check above
  return handlers as HostHandlers;
}
