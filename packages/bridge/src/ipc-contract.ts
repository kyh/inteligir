// ---------------------------------------------------------------------------
// THE MACHINERY. Everything here is DERIVED from ./ipc-registry: the
// transport-agnostic `Bridge` type a client consumes, the set of methods a host
// must implement, the event partition, and the per-method handler and event
// payload maps.
//
// Nothing in this file names a channel, and nothing should. That is what buys
// the whole thing: `ws-bridge` folds over `IPC` without naming one, the host's
// handler registry derives its required set and validates every payload with
// zero per-channel code, and adding a row to the table costs nothing here.
// ---------------------------------------------------------------------------

import type { Static, TSchema } from "@sinclair/typebox";

import type { Event, Invoke, InvokeVoid, Send } from "./ipc-entry";
import type { IPC, IpcMethod } from "./ipc-registry";

type IpcRegistry = typeof IPC;

// ---- Method partitions -------------------------------------------------------
//
// Hosts and transports slice the table along one line: events are host → client
// pushes with no handler, everything else is a host-owned handler.

/** Host → client push channels. */
export type EventMethod = {
  [K in IpcMethod]: IpcRegistry[K] extends { kind: "event" } ? K : never;
}[IpcMethod];

/** Methods the host implements. */
export type HostMethod = Exclude<IpcMethod, EventMethod>;

// ---- Wire type extraction ----------------------------------------------------

/** A method's invoke result type (never for sends/events). */
export type ResultOf<K extends IpcMethod> =
  IpcRegistry[K] extends Invoke<TSchema, infer R>
    ? R
    : IpcRegistry[K] extends InvokeVoid<infer R>
      ? R
      : never;

type MethodToFn<E> =
  E extends Invoke<TSchema, infer R>
    ? (payload: E extends Invoke<infer S, infer _> ? Static<S> : never) => Promise<R>
    : E extends InvokeVoid<infer R>
      ? () => Promise<R>
      : E extends Send<TSchema>
        ? (payload: E extends Send<infer S> ? Static<S> : never) => void
        : E extends Event<infer V>
          ? (listener: (event: V) => void) => () => void
          : never;

/** The transport-agnostic host contract a client consumes. The ws bridge and
 * the workspace's fixture Bridge both implement it — which is why the fixture
 * fails to typecheck until a new channel is covered. */
export type Bridge = {
  [K in IpcMethod]: MethodToFn<IpcRegistry[K]>;
};

/** Map a method name to the handler signature the host implements. */
export type IpcHandler<K extends IpcMethod> =
  IpcRegistry[K] extends Invoke<infer S, infer R>
    ? (payload: Static<S>) => R | Promise<R>
    : IpcRegistry[K] extends InvokeVoid<infer R>
      ? () => R | Promise<R>
      : IpcRegistry[K] extends Send<infer S>
        ? (payload: Static<S>) => void
        : never;

/** Map a method name to its broadcast event payload. */
export type IpcEvent<K extends IpcMethod> = IpcRegistry[K] extends Event<infer V> ? V : never;

/** Push one event-kind registry entry. The payload type is resolved from the
 * registry, so a renamed event channel is a compile error at the emit site —
 * which is only worth anything if the same signature holds all the way to
 * whatever writes the frame. */
export type IpcEmit = <K extends EventMethod>(method: K, payload: IpcEvent<K>) => void;
