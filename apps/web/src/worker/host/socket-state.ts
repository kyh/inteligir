// ---------------------------------------------------------------------------
// Per-socket state, carried in the socket's own attachment.
//
// A hibernating Durable Object keeps its accepted WebSockets but loses every
// in-memory field, so anything the host needs about a socket AFTER a wake —
// who it is, what it may reach, whether it ever authenticated — has to live in
// `serializeAttachment`. Nothing else survives; a `Map<WebSocket, Session>`
// would read as empty on the first message after an eviction, silently
// downgrading an authenticated socket to a stranger.
//
// So the attachment is the minimum that cannot be derived, and everything else
// is derived from it: the broadcast set is rebuilt by walking
// `ctx.getWebSockets()` and deserializing, never held.
//
// Two constraints shape the shape:
//   • The attachment is capped at 16,384 bytes and may hold only
//     structured-clone types — hence flat strings and numbers, no class
//     instances, and no room for anything speculative.
//   • Tags (`ctx.acceptWebSocket(ws, tags)`) are fixed at accept time and can
//     never change, so a socket's AUTH STATE cannot be one. Only facts already
//     true at the handshake belong there.
// ---------------------------------------------------------------------------

import type { ClientClass } from "./client-class";

/** Attachment format version. A socket carrying anything else is from another
 * deploy and is closed rather than guessed at. */
const SOCKET_STATE_VERSION = 1;

/** A socket that has completed the handshake but not the auth exchange. It may
 * send exactly one thing — an `auth` frame — before the deadline sweep. */
export type PendingSocketState = {
  readonly v: typeof SOCKET_STATE_VERSION;
  readonly phase: "pending";
  /** Accept time, in epoch ms — the auth deadline is measured from here. */
  readonly since: number;
  /** The Worker origin this socket arrived on, kept because Better Auth is
   * built per-request around it and the request is gone by the time the auth
   * frame lands. */
  readonly baseUrl: string;
};

/** An authenticated socket. `clientClass` is the capability class the
 * credential admitted to — never anything the client asserted. */
export type AuthedSocketState = {
  readonly v: typeof SOCKET_STATE_VERSION;
  readonly phase: "authed";
  readonly userId: string;
  readonly sessionId: string;
  readonly clientClass: ClientClass;
  readonly authedAt: number;
};

/** The two phases are disjoint on purpose: a pending socket has no user, and an
 * authed one has no deadline left to serve. */
type SocketState = PendingSocketState | AuthedSocketState;

export function pendingState(since: number, baseUrl: string): PendingSocketState {
  return { v: SOCKET_STATE_VERSION, phase: "pending", since, baseUrl };
}

export function authedState(
  userId: string,
  sessionId: string,
  clientClass: ClientClass,
  authedAt: number,
): AuthedSocketState {
  return { v: SOCKET_STATE_VERSION, phase: "authed", userId, sessionId, clientClass, authedAt };
}

export function writeSocketState(ws: WebSocket, state: SocketState): void {
  ws.serializeAttachment(state);
}

/** Parse a socket's attachment, or `null` when it is missing or not this
 * version's shape. Every field is proven rather than assumed — the attachment
 * is the only thing standing between a woken host and a stranger. */
export function readSocketState(ws: WebSocket): SocketState | null {
  const raw: unknown = ws.deserializeAttachment();
  if (!isRecord(raw) || raw["v"] !== SOCKET_STATE_VERSION) return null;
  if (raw["phase"] === "pending") {
    const since = raw["since"];
    const baseUrl = raw["baseUrl"];
    if (typeof since !== "number" || typeof baseUrl !== "string") return null;
    return pendingState(since, baseUrl);
  }
  if (raw["phase"] === "authed") {
    const userId = raw["userId"];
    const sessionId = raw["sessionId"];
    const clientClass = raw["clientClass"];
    const authedAt = raw["authedAt"];
    if (typeof userId !== "string" || typeof sessionId !== "string") return null;
    if (typeof authedAt !== "number") return null;
    if (clientClass !== "web" && clientClass !== "mobile") return null;
    return authedState(userId, sessionId, clientClass, authedAt);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
