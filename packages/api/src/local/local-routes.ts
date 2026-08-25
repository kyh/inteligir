// WHAT IS NOT A PROCEDURE, and where it lives. ONE spelling of every path this
// server answers outside the RPC handler, so a probe, an `<img src>`, a socket
// dial and a scenario asserting a URL all read the same constant.
//
// oRPC is for request/response with a typed client. These five have no typed
// client and must not acquire one:
//
//   /rpc            the mount point itself — the prefix the handler strips.
//   /health         a supervisor's spawn probe: unauthenticated and trivial,
//                   answered before this process has any reason to hold a
//                   credential, and disclosing nothing a bound port does not.
//   /vault/asset    an image's raw BYTES, with an ETag, a 304 on
//                   `if-none-match` and a sandbox CSP — none of which survives
//                   an RPC envelope.
//   /ws             the invalidation bus: subscribe and ping, no payload, by
//                   decision.
//   /voice/stream   PCM16 frames up, partial/final down.
//
// The two browser landings (`/pair/callback`, the connector OAuth callback)
// are not here because they belong to the flows that own their state; they are
// spelled by `@repo/api/cloud/pairing/pairing-schema` and the connectors schema.

import { z } from "zod";

/** Where the RPC handler is mounted. Client and server both derive from it. */
export const RPC_PREFIX = "/rpc";

export const HEALTH_PATH = "/health";

export const VAULT_ASSET_PATH = "/vault/asset";

/** Where the invalidation bus is served; the upgrade endpoint every client dials. */
export const WS_PATH = "/ws";

/** Dictation's own socket, beside the bus and never on it: this one carries a
 *  PAYLOAD, which the invalidation bus carries none of by decision. */
export const VOICE_STREAM_PATH = "/voice/stream";

export const healthResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** The asset route's query — read by the handler that serves the bytes and by
 *  the client that builds the URL, so the two cannot spell it differently. */
export const vaultAssetQuerySchema = z.object({ path: z.string().min(1) }).strict();

/** The URL an image's bytes come from, composed once. */
export function vaultAssetUrl(origin: string, path: string): string {
  return `${origin}${VAULT_ASSET_PATH}?path=${encodeURIComponent(path)}`;
}

/**
 * The websocket origin for an `http(s)` one. Here rather than at each dial
 * because the two ends must agree exactly: the server names this value in the
 * document's `connect-src`, and every client dials it — so a policy computed
 * one way and a URL computed another is a socket the browser refuses.
 */
export function websocketOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^http/u, "ws");
}

export function workspaceSocketUrl(httpOrigin: string): string {
  return `${websocketOrigin(httpOrigin)}${WS_PATH}`;
}

export function voiceStreamUrl(httpOrigin: string): string {
  return `${websocketOrigin(httpOrigin)}${VOICE_STREAM_PATH}`;
}
