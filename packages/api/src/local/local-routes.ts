// the paths outside the rpc handler, none of which may acquire a typed client: /health is an
// unauthenticated supervisor probe, /vault/asset answers bytes with an etag, a 304 and a
// sandbox csp, and the two sockets carry frames. the connector oauth callback, a browser
// landing, is spelled by the flow that owns its state.

import { z } from "zod";

export const RPC_PREFIX = "/rpc";

export const HEALTH_PATH = "/health";

export const VAULT_ASSET_PATH = "/vault/asset";

export const WS_PATH = "/ws";

export const VOICE_STREAM_PATH = "/voice/stream";

export const healthResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const vaultAssetQuerySchema = z.object({ path: z.string().min(1) }).strict();

export function vaultAssetUrl(origin: string, path: string): string {
  return `${origin}${VAULT_ASSET_PATH}?path=${encodeURIComponent(path)}`;
}

// the server names this value in connect-src and every client dials it; computed two ways, the browser refuses the socket
export function websocketOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^http/u, "ws");
}

export function workspaceSocketUrl(httpOrigin: string): string {
  return `${websocketOrigin(httpOrigin)}${WS_PATH}`;
}

export function voiceStreamUrl(httpOrigin: string): string {
  return `${websocketOrigin(httpOrigin)}${VOICE_STREAM_PATH}`;
}
