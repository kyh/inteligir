import { DurableObject } from "cloudflare:workers";

import {
  binaryChannelFor,
  binaryChannelForTag,
  HYDRATED_EVENTS,
  type EventMethod,
} from "@repo/bridge/ipc-registry";
import { isRecord, toErrorMessage } from "@repo/bridge/wire-helpers";
import {
  decodeBinaryFrame,
  encodeBinaryFrame,
  encodeFrame,
  parseClientFrame,
  WS_CLOSE_UNAUTHORIZED,
  type ReqFrame,
  type SendFrame,
} from "@repo/bridge/ws-protocol";

import { createAuth } from "../auth/auth";
import { logUnhandled, logUnhandledCallback } from "../log";
import { mayInvoke, mayReceive, SESSION_CLIENT_CLASS } from "./client-class";
import { collectHandlers, type WireHandler } from "./handler-registry";
import { registerCloudHandlers } from "./handlers";
import { HostEvents } from "./host-events";
import {
  authedState,
  pendingState,
  readSocketState,
  writeSocketState,
  type AuthedSocketState,
  type PendingSocketState,
} from "./socket-state";
import { createCloudStores } from "./stores";

// ---------------------------------------------------------------------------
// UserHost — one Durable Object per user, serving that user's Bridge (the
// registry's 95 host methods + 19 event channels) over ONE hibernatable
// WebSocket per client. Addressed `env.UserHost.getByName("user:" + userId)`.
//
// HIBERNATION IS THE POINT. Sockets are accepted with `ctx.acceptWebSocket`
// and served through the `webSocket*` handler methods rather than
// `addEventListener`, so an idle host with open sockets is evicted from memory
// and accrues no duration billing. The consequence runs through every design
// decision below: NO in-memory field may hold anything a later message needs.
// Per-socket identity lives in the socket's own attachment, and the broadcast
// set is rebuilt from `ctx.getWebSockets()` on every push instead of being
// tracked in a Map.
//
// AUTH is a first frame, not the handshake. A browser cannot set an
// Authorization header on `new WebSocket()`, and the two alternatives are
// worse: a token in the query string lands in every request log, and a cookie
// on the upgrade makes the socket forgeable from any page the browser has
// open. So the URL carries only the userId — an addressing hint, not a
// credential — and the socket must present the session bearer in an `auth`
// frame that this object verifies AND binds to its own name. A caller who
// names someone else's host reaches an object that refuses them.
//
// That leaves the same accepted residual the vault surface records: naming a
// userId instantiates an empty Durable Object. The cost is an object with two
// unwritten KV keys, never another user's state.
// ---------------------------------------------------------------------------

/** Namespace prefix for the object name. The DO namespace is already this
 * class's own, so the prefix buys legibility in logs rather than isolation. */
const USER_HOST_PREFIX = "user:";

/** The object name serving `userId` — the one place the addressing scheme is
 * spelled, shared by the route that dials it and the bind check that proves
 * a socket reached the right one. */
export function userHostName(userId: string): string {
  return `${USER_HOST_PREFIX}${userId}`;
}

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
 * socket speaks, so a future frame vocabulary can enumerate the old ones. */
const SOCKET_TAG_V1 = "v1";

// RFC 6455 close codes used below; the 44xx application codes live in
// ws-protocol beside the frames they refuse.
const WS_CLOSE_NORMAL = 1000;
const WS_CLOSE_ABNORMAL = 1006;
const WS_CLOSE_POLICY_VIOLATION = 1008;
const WS_CLOSE_MESSAGE_TOO_BIG = 1009;
const WS_CLOSE_INTERNAL_ERROR = 1011;
const WS_CLOSE_SERVICE_RESTART = 1012;

export class UserHost extends DurableObject<Env> {
  /** Per-INSTANCE, never module scope: one isolate serves many tenants' hosts
   * (see ./host-events). */
  private readonly events = new HostEvents();

  /**
   * The one flat dispatch map.
   *
   * NOTHING outside `resolveHandler()` may read it, and nothing outside
   * `sendEvent()` may push an event frame. Those two methods are the ONLY
   * places the capability class is consulted, because scattering the check is
   * how it gets forgotten — and a forgotten check fails OPEN. Every path that
   * re-implements "look up a handler" or "write to a socket" — the hydration
   * push, event broadcast, binary frames — is a hole.
   * `__tests__/no-ungated-dispatch.test.ts` fails the build if a new caller
   * reaches around either chokepoint.
   */
  private readonly dispatch: ReadonlyMap<string, WireHandler>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const stores = createCloudStores(ctx.storage.kv);
    const handlers = collectHandlers((handle, shim) => {
      registerCloudHandlers(handle, shim, { stores, events: this.events });
    });
    this.dispatch = new Map(Object.entries(handlers));
    this.events.onAny((method, payload) => {
      this.broadcast(method, payload);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      return await this.upgrade(request);
    } catch (error) {
      logUnhandled("user-host", request, error);
      return new Response("internal error", { status: 500 });
    }
  }

  private async upgrade(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    if (this.pendingSocketCount() >= PRE_AUTH_MAX_SOCKETS) {
      return new Response("too many pending connections", { status: 429 });
    }

    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [SOCKET_TAG_V1]);
    const now = Date.now();
    writeSocketState(server, pendingState(now, new URL(request.url).origin));
    await this.armAuthDeadline(now + AUTH_DEADLINE_MS);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---- the two chokepoints -------------------------------------------------

  /** THE inbound chokepoint. Every path that runs a handler on a socket's
   * behalf — req, send, binary, and the hydration push — resolves through here,
   * so the class gate cannot be skipped by adding a fourth caller. `forbidden`
   * and `unknown` stay distinct: callers answer a req differently, and
   * conflating them would also change what an unauthorized peer learns. */
  private resolveHandler(
    state: AuthedSocketState,
    method: string,
  ): { ok: true; handler: WireHandler } | { ok: false; reason: "forbidden" | "unknown" } {
    if (!mayInvoke(state.clientClass, method)) return { ok: false, reason: "forbidden" };
    const handler = this.dispatch.get(method);
    if (handler === undefined) return { ok: false, reason: "unknown" };
    return { ok: true, handler };
  }

  /** THE outbound chokepoint for host → client pushes. Broadcast and hydration
   * both land here, so an event can never reach a client the class gate would
   * have withheld it from. `frame` is pre-encoded by the caller because a
   * broadcast encodes once and fans out to many sockets. */
  private sendEvent(
    ws: WebSocket,
    state: AuthedSocketState,
    method: string,
    frame: string | ArrayBufferView,
  ): void {
    if (!mayReceive(state.clientClass, method)) return;
    if (ws.readyState === WebSocket.READY_STATE_OPEN) ws.send(frame);
  }

  // ---- socket lifecycle ----------------------------------------------------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      await this.dispatchMessage(ws, message);
    } catch (error) {
      logUnhandledCallback("user-host", "webSocketMessage", error);
      ws.close(WS_CLOSE_INTERNAL_ERROR, "internal error");
    }
  }

  private async dispatchMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const state = readSocketState(ws);
    if (state === null) {
      // An attachment this build cannot read belongs to another deploy's
      // format. It must never be treated as authenticated, and the client's
      // supervisor reconnects into the current one.
      ws.close(WS_CLOSE_SERVICE_RESTART, "reconnect required");
      return;
    }
    if (state.phase === "pending") {
      await this.handlePreAuth(ws, state, message);
      return;
    }
    if (typeof message !== "string") {
      this.handleBinary(ws, state, message);
      return;
    }
    const frame = parseClientFrame(message);
    if (frame === null) return;
    if (frame.t === "req") {
      await this.handleReq(ws, state, frame);
      return;
    }
    if (frame.t === "send") this.handleSend(state, frame);
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Nothing to release: a socket's whole state is its attachment, and the
    // broadcast set is rebuilt per push. The close is echoed only to finish the
    // handshake — 1006 is never sendable, so a peer that vanished is answered
    // as a normal close.
    try {
      ws.close(code === WS_CLOSE_ABNORMAL ? WS_CLOSE_NORMAL : code, reason);
    } catch {
      // The peer already completed the handshake.
    }
  }

  override webSocketError(_ws: WebSocket, error: unknown): void {
    logUnhandledCallback("user-host", "webSocketError", error);
  }

  /**
   * The auth deadline sweep. Closes every pending socket past its deadline and
   * re-arms for the earliest one still waiting, so one alarm serves any number
   * of them.
   */
  override async alarm(): Promise<void> {
    const now = Date.now();
    let earliest: number | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const state = readSocketState(ws);
      if (state === null || state.phase !== "pending") continue;
      const deadline = state.since + AUTH_DEADLINE_MS;
      if (deadline <= now) {
        ws.close(WS_CLOSE_UNAUTHORIZED, "authentication deadline elapsed");
        continue;
      }
      earliest = earliest === null ? deadline : Math.min(earliest, deadline);
    }
    if (earliest !== null) await this.ctx.storage.setAlarm(earliest);
  }

  /** Arm the sweep for `deadline` unless one is already due sooner. This object
   * has no other alarm; a second use would have to multiplex with this one
   * rather than overwrite it. */
  private async armAuthDeadline(deadline: number): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > deadline) await this.ctx.storage.setAlarm(deadline);
  }

  // ---- auth ----------------------------------------------------------------

  private async handlePreAuth(
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
      // `pair` is a desktop remote-access frame with no counterpart here: a
      // cloud client has an account, not a pairing token.
      ws.close(WS_CLOSE_UNAUTHORIZED, "not authenticated");
      return;
    }
    const admitted = await this.authenticate(state, frame.token);
    if (admitted === null) {
      ws.close(WS_CLOSE_UNAUTHORIZED, "invalid session");
      return;
    }
    writeSocketState(ws, admitted);
    ws.send(encodeFrame({ t: "welcome" }));
    await this.hydrate(ws, admitted);
  }

  /**
   * Resolve the session bearer, or `null` to refuse. Two conditions, both
   * required: Better Auth accepts the token, AND the session's user is the one
   * this object serves. The second is what makes the userId in the URL a mere
   * address — naming another user's host reaches an object that refuses.
   */
  private async authenticate(
    state: PendingSocketState,
    token: string,
  ): Promise<AuthedSocketState | null> {
    const auth = createAuth(this.env, state.baseUrl);
    const result = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });
    if (result === null) return null;
    if (this.ctx.id.name !== userHostName(result.user.id)) return null;
    // The class comes from the credential, never from the wire: one admission
    // path, one class (see ./client-class).
    return authedState(result.user.id, result.session.id, SESSION_CLIENT_CLASS, Date.now());
  }

  // ---- dispatch ------------------------------------------------------------

  private async handleReq(ws: WebSocket, state: AuthedSocketState, frame: ReqFrame): Promise<void> {
    const resolved = this.resolveHandler(state, frame.method);
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

  private handleSend(state: AuthedSocketState, frame: SendFrame): void {
    const resolved = this.resolveHandler(state, frame.method);
    if (!resolved.ok) return;
    try {
      resolved.handler(frame.payload);
    } catch (error) {
      logUnhandledCallback("user-host", `send:${frame.method}`, error);
    }
  }

  private handleBinary(ws: WebSocket, state: AuthedSocketState, message: ArrayBuffer): void {
    const decoded = decodeBinaryFrame(message);
    if (decoded === null) return;
    const channel = binaryChannelForTag(decoded.tag);
    if (channel === undefined) {
      ws.close(WS_CLOSE_POLICY_VIOLATION, "unknown binary channel");
      return;
    }
    const resolved = this.resolveHandler(state, channel.method);
    if (!resolved.ok) return;
    try {
      resolved.handler(decoded.payload);
    } catch (error) {
      logUnhandledCallback("user-host", `binary:${channel.method}`, error);
    }
  }

  // ---- events --------------------------------------------------------------

  /**
   * The authenticated sockets, rebuilt from attachments on every call.
   *
   * This is the hibernation contract in one method: a `Map<WebSocket, …>` held
   * across messages reads as EMPTY after the first eviction, so every push
   * would silently reach nobody. Walking `ctx.getWebSockets()` costs a
   * deserialize per socket and cannot be wrong.
   */
  private authedSockets(): Array<{ ws: WebSocket; state: AuthedSocketState }> {
    const open: Array<{ ws: WebSocket; state: AuthedSocketState }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const state = readSocketState(ws);
      if (state !== null && state.phase === "authed") open.push({ ws, state });
    }
    return open;
  }

  private pendingSocketCount(): number {
    let count = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (readSocketState(ws)?.phase === "pending") count += 1;
    }
    return count;
  }

  private broadcast(method: EventMethod, payload: unknown): void {
    // Registry-declared binary channels cross as [tag][bytes] instead of JSON;
    // the client reconstitutes the payload from the same declaration.
    const binary = binaryChannelFor(method);
    if (binary !== undefined) {
      const bytes = "field" in binary && isRecord(payload) ? payload[binary.field] : payload;
      if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return;
      const binaryFrame = encodeBinaryFrame(binary.tag, bytes);
      for (const { ws, state } of this.authedSockets()) {
        this.sendEvent(ws, state, method, binaryFrame);
      }
      return;
    }
    const frame = encodeFrame({ t: "evt", method, payload });
    for (const { ws, state } of this.authedSockets()) this.sendEvent(ws, state, method, frame);
  }

  /**
   * Push current state as evt frames for the registry's HYDRATED_EVENTS, so a
   * client that just connected is never sitting on empty panels.
   *
   * Gated by BOTH chokepoints: the getter must be callable by this client AND
   * the event deliverable to it. A hydration push is a read the client never
   * asked for, so it clears the same bar as asking.
   *
   * Most of the set no-ops here, and that is the design working: the sync and
   * remote-access getters are shims that throw, so their events simply are not
   * pushed. Only `onAppState` has a real getter today.
   */
  private async hydrate(ws: WebSocket, state: AuthedSocketState): Promise<void> {
    for (const [event, getter] of Object.entries(HYDRATED_EVENTS)) {
      const resolved = this.resolveHandler(state, getter);
      if (!resolved.ok) continue;
      try {
        const payload = await resolved.handler(undefined);
        this.sendEvent(ws, state, event, encodeFrame({ t: "evt", method: event, payload }));
      } catch {
        // Hydration never breaks the connection it heals.
      }
    }
  }
}
