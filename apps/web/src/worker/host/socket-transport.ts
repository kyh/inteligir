// ---------------------------------------------------------------------------
// The Bridge socket, whole: accept → authenticate → dispatch → gated push.
//
// ONE module answers "how does a socket work", from the upgrade through the
// pre-auth policing, the ticket spend, dispatch and the deadline reap. The
// object forwards platform callbacks into it and implements none of the
// protocol itself — a seam that began after authentication would leave half
// the answer in the class and half here.
//
// HIBERNATION IS THE POINT, and it shapes everything here. Sockets are accepted
// with `ctx.acceptWebSocket` and served through the object's `webSocket*`
// handlers rather than `addEventListener`, so an idle host with open sockets is
// evicted and accrues no duration billing. The consequence is a rule: NO field
// on this class may hold anything a later message needs. Per-socket identity
// lives in the socket's own attachment (./socket-state); the socket set is
// rebuilt from `ctx.getWebSockets()` on every pass rather than tracked in a Map
// (a Map reads EMPTY after the first eviction, so every push would silently
// reach nobody); the auth deadline is a DO alarm, never a `setTimeout` — a
// pending timer PINS the object, which is the eviction this whole transport
// exists to get.
//
// ./socket-gate stays the two chokepoints (resolve and push) and is INTERNAL to
// this module: nothing outside can dispatch a frame or address a socket without
// going through it.
// ---------------------------------------------------------------------------

import { binaryChannelForTag } from "@repo/bridge/channel-policy";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import {
  decodeBinaryFrame,
  encodeFrame,
  parseClientFrame,
  WS_CLOSE_UNAUTHORIZED,
  type ReqFrame,
  type SendFrame,
} from "@repo/bridge/ws-protocol";
import type { EventMethod, IpcEvent } from "@repo/bridge/ipc-contract";

import { logUnhandledCallback } from "../log";
import type { HostHandlers } from "./handler-registry";
import { SocketGate } from "./socket-gate";
import type { SocketTickets } from "./socket-ticket";
import {
  authedState,
  pendingState,
  readSocketState,
  writeSocketState,
  type AuthedSocketState,
  type PendingSocketState,
} from "./socket-state";

/**
 * How long a socket may sit unauthenticated. Enforced by a DO ALARM, not a
 * `setTimeout`: a pending timer pins the object in memory, which is exactly
 * the hibernation the transport exists to get. The alarm survives eviction,
 * so a socket that connects and then says nothing at all is still reaped —
 * which a "check it on the first message" deadline would never do, that being
 * the one client this bound exists for.
 */
const AUTH_DEADLINE_MS = 10_000;

/** Sockets allowed to sit unauthenticated at once. An `auth` frame follows the
 * handshake immediately, so a queue of pending sockets is not a real client. */
const PRE_AUTH_MAX_SOCKETS = 8;

/** An `auth` frame is ~100 bytes. Anything larger is not something worth
 * parsing on behalf of a caller who has not identified themselves. */
const PRE_AUTH_MAX_FRAME_CHARS = 4096;

/** Immutable at accept time, so only facts already settled belong here — which
 * is precisely why the auth state does not. It marks the wire protocol this
 * socket speaks, so a second frame vocabulary can enumerate its predecessors. */
const SOCKET_TAG_V1 = "v1";

// RFC 6455 close codes used below; the 44xx application codes live in
// ws-protocol beside the frames they refuse.
const WS_CLOSE_NORMAL = 1000;
const WS_CLOSE_ABNORMAL = 1006;
const WS_CLOSE_POLICY_VIOLATION = 1008;
const WS_CLOSE_MESSAGE_TOO_BIG = 1009;
const WS_CLOSE_INTERNAL_ERROR = 1011;
const WS_CLOSE_SERVICE_RESTART = 1012;

export type SocketTransportDeps = {
  readonly ctx: DurableObjectState;
  /** The complete handler map the gate dispatches into. */
  readonly handlers: HostHandlers;
  /** Unspent single-use tickets — the only credential a socket may present. */
  readonly tickets: SocketTickets;
  /** A pending socket appeared, so the auth deadline may now be sooner. Says a
   * deadline moved; never arms an alarm itself (./host-alarm owns the one). */
  readonly onDeadlineChanged: () => void;
  /**
   * A socket authenticated, carrying the origin it arrived on.
   *
   * Runs BEFORE the socket is marked authed and welcomed, so anything it writes
   * cannot broadcast ahead of that client's `welcome` — a client that has not
   * been welcomed has not subscribed to anything yet.
   */
  readonly onAuthenticated: (origin: string) => Promise<void>;
};

export class SocketTransport {
  private readonly deps: SocketTransportDeps;
  private readonly gate: SocketGate;

  constructor(deps: SocketTransportDeps) {
    this.deps = deps;
    this.gate = new SocketGate({
      handlers: deps.handlers,
      sockets: () => deps.ctx.getWebSockets(),
    });
  }

  // ---- accept ---------------------------------------------------------------

  upgrade(request: Request): Response {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    if (this.pendingCount() >= PRE_AUTH_MAX_SOCKETS) {
      return new Response("too many pending connections", { status: 429 });
    }

    const pair = new WebSocketPair();
    const server = pair[1];
    this.deps.ctx.acceptWebSocket(server, [SOCKET_TAG_V1]);
    writeSocketState(server, pendingState(Date.now(), new URL(request.url).origin));
    // The socket is in `ctx.getWebSockets()` the moment it is accepted, so the
    // auth-deadline concern can already see it.
    this.deps.onDeadlineChanged();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---- the inbound half -----------------------------------------------------

  async message(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const state = readSocketState(ws);
    if (state === null) {
      // An attachment this build cannot read belongs to another deploy's
      // format. It must never be treated as authenticated, and the client's
      // supervisor reconnects into the current one.
      ws.close(WS_CLOSE_SERVICE_RESTART, "reconnect required");
      return;
    }
    if (state.phase === "pending") {
      await this.authenticate(ws, state, message);
      return;
    }
    if (typeof message !== "string") {
      this.binary(ws, state, message);
      return;
    }
    const frame = parseClientFrame(message);
    if (frame === null) return;
    if (frame.t === "req") {
      await this.request(ws, state, frame);
      return;
    }
    if (frame.t === "send") this.send(state, frame);
  }

  /** Answer a close so the handshake finishes. Nothing to release: a socket's
   * whole state is its attachment, and the socket set is rebuilt per pass. 1006
   * is never sendable, so a peer that vanished is answered as a normal close. */
  closed(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code === WS_CLOSE_ABNORMAL ? WS_CLOSE_NORMAL : code, reason);
    } catch {
      // The peer already completed the handshake.
    }
  }

  /** Close a socket the object can no longer serve. */
  closeAll(code: number, reason: string): void {
    for (const ws of this.deps.ctx.getWebSockets()) ws.close(code, reason);
  }

  // ---- the outbound half ----------------------------------------------------

  broadcast<K extends EventMethod>(method: K, payload: IpcEvent<K>): void {
    this.gate.broadcast(method, payload);
  }

  // ---- the auth deadline, as an alarm concern -------------------------------

  /** Close every pending socket past its deadline. */
  reapPending(now: number): void {
    for (const ws of this.deps.ctx.getWebSockets()) {
      const state = readSocketState(ws);
      if (state === null || state.phase !== "pending") continue;
      if (state.since + AUTH_DEADLINE_MS <= now) {
        ws.close(WS_CLOSE_UNAUTHORIZED, "authentication deadline elapsed");
      }
    }
  }

  /** The earliest pending socket's deadline, or null when none is owed. */
  nextDeadline(now: number): number | null {
    let earliest: number | null = null;
    for (const ws of this.deps.ctx.getWebSockets()) {
      const state = readSocketState(ws);
      if (state === null || state.phase !== "pending") continue;
      const deadline = state.since + AUTH_DEADLINE_MS;
      if (deadline > now && (earliest === null || deadline < earliest)) earliest = deadline;
    }
    return earliest;
  }

  // ---- internals ------------------------------------------------------------

  private pendingCount(): number {
    let count = 0;
    for (const ws of this.deps.ctx.getWebSockets()) {
      if (readSocketState(ws)?.phase === "pending") count += 1;
    }
    return count;
  }

  private async authenticate(
    ws: WebSocket,
    state: PendingSocketState,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") {
      ws.close(WS_CLOSE_POLICY_VIOLATION, "binary frame before auth");
      return;
    }
    if (message.length > PRE_AUTH_MAX_FRAME_CHARS) {
      ws.close(WS_CLOSE_MESSAGE_TOO_BIG, "pre-auth frame too large");
      return;
    }
    const frame = parseClientFrame(message);
    if (frame === null || frame.t !== "auth") {
      // The FIRST frame must be the auth frame. Anything else — a req a client
      // sent optimistically, a malformed frame — closes rather than waiting:
      // there is no state here worth keeping for a peer that did not say who it
      // is.
      ws.close(WS_CLOSE_UNAUTHORIZED, "not authenticated");
      return;
    }
    // The class comes from the ticket, never from the wire: this object minted
    // it against a verified session under the Origin rules (./client-class),
    // and spending it is atomic, so a second socket presenting the same one is
    // refused.
    const clientClass = this.deps.tickets.consume(frame.ticket, Date.now());
    if (clientClass === null) {
      ws.close(WS_CLOSE_UNAUTHORIZED, "invalid ticket");
      return;
    }
    const admitted = authedState(clientClass, Date.now());
    await this.deps.onAuthenticated(state.origin);
    writeSocketState(ws, admitted);
    ws.send(encodeFrame({ t: "welcome" }));
    await this.gate.hydrate(ws, admitted);
  }

  private async request(ws: WebSocket, state: AuthedSocketState, frame: ReqFrame): Promise<void> {
    const resolved = this.gate.resolve(state, frame.method);
    if (!resolved.ok) {
      const error =
        resolved.reason === "forbidden"
          ? `${frame.method} is not available to this client`
          : `${frame.method} is not available on this host`;
      ws.send(encodeFrame({ t: "res", id: frame.id, ok: false, error }));
      return;
    }
    try {
      const result = await resolved.handler(frame.payload);
      ws.send(encodeFrame({ t: "res", id: frame.id, ok: true, result }));
    } catch (error) {
      // Message only — never a stack over the wire.
      ws.send(encodeFrame({ t: "res", id: frame.id, ok: false, error: toErrorMessage(error) }));
    }
  }

  private send(state: AuthedSocketState, frame: SendFrame): void {
    const resolved = this.gate.resolve(state, frame.method);
    if (!resolved.ok) return;
    try {
      resolved.handler(frame.payload);
    } catch (error) {
      logUnhandledCallback("user-host", `send:${frame.method}`, error);
    }
  }

  private binary(ws: WebSocket, state: AuthedSocketState, message: ArrayBuffer): void {
    const decoded = decodeBinaryFrame(message);
    if (decoded === null) return;
    const channel = binaryChannelForTag(decoded.tag);
    if (channel === undefined) {
      ws.close(WS_CLOSE_POLICY_VIOLATION, "unknown binary channel");
      return;
    }
    const resolved = this.gate.resolve(state, channel.method);
    if (!resolved.ok) return;
    try {
      resolved.handler(decoded.payload);
    } catch (error) {
      logUnhandledCallback("user-host", `binary:${channel.method}`, error);
    }
  }
}

export { WS_CLOSE_INTERNAL_ERROR };
