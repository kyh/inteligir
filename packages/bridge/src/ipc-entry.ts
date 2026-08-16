// ---------------------------------------------------------------------------
// The four kinds of channel a registry row can be, and the four one-line
// constructors that build them. This is the whole vocabulary ./ipc-registry is
// written in — and the whole input ./ipc-contract derives the Bridge type, the
// host's required-method set and the event partition from.
//
// The `_payload`/`_result`/`_event` fields are PHANTOM: optional, never set at
// runtime, they exist purely so `infer` can pull the wire types back out of an
// entry. That is what lets a row say its result type without repeating it
// anywhere else.
// ---------------------------------------------------------------------------

import type { Static, TSchema } from "@sinclair/typebox";

/** Client → host, with a payload, awaiting a result. */
export type Invoke<S extends TSchema, R> = {
  readonly kind: "invoke";
  readonly payload: S;
  readonly _payload?: Static<S>;
  readonly _result?: R;
};

/** Client → host, no payload, awaiting a result. */
export type InvokeVoid<R> = {
  readonly kind: "invoke-void";
  readonly _result?: R;
};

/** Client → host, fire-and-forget (a throw is swallowed and logged). */
export type Send<S extends TSchema> = {
  readonly kind: "send";
  readonly payload: S;
  readonly _payload?: Static<S>;
};

/** Host → client push. No handler; emitted through the host's `IpcEmit`. */
export type Event<E> = {
  readonly kind: "event";
  readonly _event?: E;
};

export type IpcEntry =
  | Invoke<TSchema, unknown>
  | InvokeVoid<unknown>
  | Send<TSchema>
  | Event<unknown>;

export const invoke = <S extends TSchema, R>(payload: S): Invoke<S, R> => ({
  kind: "invoke",
  payload,
});
export const invokeVoid = <R>(): InvokeVoid<R> => ({ kind: "invoke-void" });
export const send = <S extends TSchema>(payload: S): Send<S> => ({ kind: "send", payload });
export const event = <E>(): Event<E> => ({ kind: "event" });
