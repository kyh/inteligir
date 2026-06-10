// ---------------------------------------------------------------------------
// Room addressing & connection auth.
//
// Clients authenticate at connect time: role + raw pairing token travel as
// query params on the WebSocket URL (over TLS). The Worker parses them with
// `parseConnectionAuth` in onConnect and refuses the connection on a missing
// role, missing token, or token-hash mismatch — unauthenticated sockets never
// enter the room. This module stays free of partysocket/Electron/RN/Worker
// imports: it builds plain config objects and parses standard URLs.
// ---------------------------------------------------------------------------

import type { PeerRole } from "./protocol";

// partyserver routes to a Durable Object "party" derived from its class name
// (DispatchServer -> dispatch-server). This is the protocol routing key, not
// branding — it must match the server's registered DO class.
export const PARTY_NAME = "dispatch-server";

// Local `wrangler dev` port; clients derive the dev host from this.
export const SERVER_PORT = "8787";
export const DEFAULT_SERVER_HOST = `localhost:${SERVER_PORT}`;

// Deployed Cloudflare Worker (apps/server, name "inteligir-server"). Packaged
// desktop/mobile builds connect here; dev builds use DEFAULT_SERVER_HOST.
// Override per-environment via DISPATCH_SERVER_HOST / EXPO_PUBLIC_SERVER_HOST.
export const PRODUCTION_SERVER_HOST = "inteligir-server.kyh.workers.dev";

/** Query param names carrying connection auth. The Worker reads these from
 * the upgrade request URL; clients send them via PartySocket's `query`. */
export const ROLE_QUERY_PARAM = "role";
export const TOKEN_QUERY_PARAM = "token";

/** Spreadable PartySocket constructor options (kept structural so this
 * package doesn't depend on partysocket). */
export type ConnectionConfig = {
  host: string;
  party: string;
  room: string;
  query: { role: PeerRole; token: string };
};

export function buildConnectionConfig(options: {
  host: string;
  roomId: string;
  role: PeerRole;
  token: string;
}): ConnectionConfig {
  return {
    host: options.host,
    party: PARTY_NAME,
    room: options.roomId,
    // Keys must stay in sync with ROLE_QUERY_PARAM / TOKEN_QUERY_PARAM
    // (asserted in room.test.ts).
    query: { role: options.role, token: options.token },
  };
}

export type ConnectionAuth = { role: PeerRole; token: string };

/** Structural stand-in for the WHATWG URL, so this module typechecks without
 * lib.dom / @types/node. Pass `new URL(request.url)`. */
export type ConnectionAuthSource = {
  searchParams: { get(name: string): string | null };
};

/** Extract and validate connection auth from an upgrade request URL. Returns
 * null when the role is missing/unknown or the token is absent — the server
 * must refuse the connection in that case (before token-hash verification). */
export function parseConnectionAuth(url: ConnectionAuthSource): ConnectionAuth | null {
  const role = url.searchParams.get(ROLE_QUERY_PARAM);
  const token = url.searchParams.get(TOKEN_QUERY_PARAM);
  if (role !== "desktop" && role !== "mobile") return null;
  if (!token) return null;
  return { role, token };
}
