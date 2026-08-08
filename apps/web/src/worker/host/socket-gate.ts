// ---------------------------------------------------------------------------
// The capability gate every frame crosses, in both directions.
//
// The gate itself is a pure predicate pair over a ClientClass (./client-class).
// What makes it hold is that there are exactly TWO places that consult it:
// `resolve()` for everything a socket asks of this host, and `push()` for every
// byte this host sends a socket unasked. Scattering either check is how it gets
// forgotten, and a forgotten check fails OPEN — a client reaching a method or
// an event its class never named.
//
// So this class owns both, plus everything that would otherwise have to
// re-implement them: the dispatch map, the socket enumeration, event encoding,
// the broadcast fan-out and the reconnect hydration push. Nothing outside it
// looks up a handler or writes an event frame.
//
// `__tests__/socket-gate.test.ts` drives both directions through a fake socket
// — inverting either predicate turns it red. `__tests__/no-ungated-dispatch.ts`
// is the backstop that fails when a THIRD path appears, which is the failure
// mode a behavioural test cannot see.
// ---------------------------------------------------------------------------

import { binaryChannelFor, HYDRATED_EVENTS } from "@repo/bridge/channel-policy";
import type { EventMethod } from "@repo/bridge/ipc-contract";
import { isRecord } from "@repo/bridge/wire-helpers";
import { encodeBinaryFrame, encodeFrame } from "@repo/bridge/ws-protocol";

import { mayInvoke, mayReceive } from "./client-class";
import type { WireHandler } from "./handler-registry";
import { readSocketState, type AuthedSocketState } from "./socket-state";

/**
 * A socket, as the gate needs one: who it is (its own attachment), whether it
 * is still open, and a way to write one frame.
 *
 * Narrower than `WebSocket` on purpose — it is the whole surface the gate
 * touches, so its suite can drive both directions with a plain object and
 * assert what a client was and was not sent.
 */
export type GateSocket = {
  readonly readyState: number;
  send(frame: string | ArrayBufferView): void;
  deserializeAttachment(): unknown;
};

/**
 * What a socket's request resolved to.
 *
 * `forbidden` and `unknown` stay distinct: callers answer a req differently,
 * and conflating them would also change what an unauthorized peer learns — the
 * class gate answers BEFORE the map is consulted, so a client outside a
 * capability cannot use the two refusals as an oracle for what this host
 * implements.
 */
export type Resolution =
  | { readonly ok: true; readonly handler: WireHandler }
  | { readonly ok: false; readonly reason: "forbidden" | "unknown" };

export type SocketGateDeps = {
  /**
   * Name → handler. `HostHandlers` is what production passes and where
   * completeness is proven (./handler-registry throws on a gap); the gate only
   * ever looks a name up, so it asks for no more than that — which is what lets
   * its suite drive it with the handful of methods a case is about.
   */
  readonly handlers: Readonly<Record<string, WireHandler>>;
  /**
   * This host's sockets, re-read on every call.
   *
   * A `Map<WebSocket, …>` held across messages reads as EMPTY after the first
   * hibernation, so every push would silently reach nobody. Walking the live
   * set costs a deserialize per socket and cannot be wrong.
   */
  readonly sockets: () => Iterable<GateSocket>;
};

export class SocketGate {
  private readonly dispatch: ReadonlyMap<string, WireHandler>;
  private readonly sockets: () => Iterable<GateSocket>;

  constructor(deps: SocketGateDeps) {
    this.dispatch = new Map(Object.entries(deps.handlers));
    this.sockets = deps.sockets;
  }

  /** THE inbound chokepoint. Every path that runs a handler on a socket's
   * behalf — req, send, binary, and the hydration push — resolves through here,
   * so the class gate cannot be skipped by adding a fourth caller. */
  resolve(state: AuthedSocketState, method: string): Resolution {
    if (!mayInvoke(state.clientClass, method)) return { ok: false, reason: "forbidden" };
    const handler = this.dispatch.get(method);
    if (handler === undefined) return { ok: false, reason: "unknown" };
    return { ok: true, handler };
  }

  /** Push one event to every authenticated socket its class admits it to. */
  broadcast(method: EventMethod, payload: unknown): void {
    // Encoded ONCE and fanned out: a broadcast is the same bytes on every
    // socket.
    const frame = this.encode(method, payload);
    if (frame === null) return;
    for (const socket of this.sockets()) {
      const state = readSocketState(socket);
      if (state !== null && state.phase === "authed") this.push(socket, state, method, frame);
    }
  }

  /**
   * Push current state as evt frames for the registry's HYDRATED_EVENTS, so a
   * client that just connected is never sitting on empty panels.
   *
   * Gated by BOTH directions: the getter must be callable by this client AND
   * the event deliverable to it. A hydration push is a read the client never
   * asked for, so it clears the same bar as asking — and the getter runs
   * host-side, which is exactly how a reconnect would otherwise volunteer state
   * the method gate forbids asking for.
   */
  async hydrate(socket: GateSocket, state: AuthedSocketState): Promise<void> {
    for (const [event, getter] of Object.entries(HYDRATED_EVENTS)) {
      const resolved = this.resolve(state, getter);
      if (!resolved.ok) continue;
      try {
        const payload = await resolved.handler(undefined);
        const frame = this.encode(event, payload);
        if (frame !== null) this.push(socket, state, event, frame);
      } catch {
        // Hydration never breaks the connection it heals.
      }
    }
  }

  /** THE outbound chokepoint for host → client pushes. Broadcast and hydration
   * both land here, so an event can never reach a client the class gate would
   * have withheld it from. */
  private push(
    socket: GateSocket,
    state: AuthedSocketState,
    method: string,
    frame: string | ArrayBufferView,
  ): void {
    if (!mayReceive(state.clientClass, method)) return;
    if (socket.readyState === WebSocket.READY_STATE_OPEN) socket.send(frame);
  }

  /** One event as the bytes it crosses as, or null when a registry-declared
   * binary channel was handed something that is not a buffer. */
  private encode(method: string, payload: unknown): string | ArrayBufferView | null {
    // Registry-declared binary channels cross as [tag][bytes] instead of JSON;
    // the client reconstitutes the payload from the same declaration.
    const binary = binaryChannelFor(method);
    if (binary === undefined) return encodeFrame({ t: "evt", method, payload });
    const bytes = "field" in binary && isRecord(payload) ? payload[binary.field] : payload;
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return null;
    return encodeBinaryFrame(binary.tag, bytes);
  }
}
