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

import { isRecord } from "@repo/bridge/wire-helpers";

import type { ClientClass } from "./client-class";

/** Attachment format version. A socket carrying anything else is from another
 * deploy and is closed rather than guessed at. */
const SOCKET_STATE_VERSION = 2;

/** A socket that has completed the handshake but not the auth exchange. It may
 * send exactly one thing — an `auth` frame — before the deadline sweep. */
export type PendingSocketState = {
  readonly v: typeof SOCKET_STATE_VERSION;
  readonly phase: "pending";
  /** Accept time, in epoch ms — the auth deadline is measured from here. */
  readonly since: number;
  /** The origin this socket arrived on, kept because the request is gone by the
   * time the auth frame lands and the OAuth redirect URI falls back to it. */
  readonly origin: string;
};

/**
 * An authenticated socket, and the whole of what the host needs to know about
 * one: which capability class its ticket was minted for, and when it was spent.
 *
 * There is no userId here, and that absence is the tenancy: an object serves
 * exactly one user, so a per-socket userId would restate the object's own name
 * — a second copy of a fact, which is a second copy that can be wrong.
 */
export type AuthedSocketState = {
  readonly v: typeof SOCKET_STATE_VERSION;
  readonly phase: "authed";
  readonly clientClass: ClientClass;
  readonly authedAt: number;
};

/** The two phases are disjoint on purpose: a pending socket has no class, and
 * an authed one has no deadline left to serve. */
type SocketState = PendingSocketState | AuthedSocketState;

export function pendingState(since: number, origin: string): PendingSocketState {
  return { v: SOCKET_STATE_VERSION, phase: "pending", since, origin };
}

export function authedState(clientClass: ClientClass, authedAt: number): AuthedSocketState {
  return { v: SOCKET_STATE_VERSION, phase: "authed", clientClass, authedAt };
}

export function writeSocketState(ws: WebSocket, state: SocketState): void {
  ws.serializeAttachment(state);
}

/** Parse a socket's attachment, or `null` when it is missing or not this
 * version's shape. Every field is proven rather than assumed — the attachment
 * is the only thing standing between a woken host and a stranger.
 *
 * Takes the attachment reader rather than a `WebSocket`, because that is the
 * whole of what it needs and it is what lets the gate's suite drive a fake. */
export function readSocketState(ws: { deserializeAttachment(): unknown }): SocketState | null {
  const raw: unknown = ws.deserializeAttachment();
  if (!isRecord(raw) || raw["v"] !== SOCKET_STATE_VERSION) return null;
  if (raw["phase"] === "pending") {
    const since = raw["since"];
    const origin = raw["origin"];
    if (typeof since !== "number" || typeof origin !== "string") return null;
    return pendingState(since, origin);
  }
  if (raw["phase"] === "authed") {
    const clientClass = raw["clientClass"];
    const authedAt = raw["authedAt"];
    if (typeof authedAt !== "number") return null;
    if (clientClass !== "web" && clientClass !== "mobile") return null;
    return authedState(clientClass, authedAt);
  }
  return null;
}
