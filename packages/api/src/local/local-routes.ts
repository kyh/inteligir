// the paths outside the rpc handler, none of which may acquire a typed client: /health is an
// unauthenticated supervisor probe, /vault/asset answers bytes with an etag, a 304 and a
// sandbox csp, /html-frame is the document a note's html block runs in under its own sandbox
// csp, and the /ws socket carries frames. the connector oauth callback, a browser landing, is
// spelled by the flow that owns its state.

import { z } from "zod";

export const RPC_PREFIX = "/rpc";

export const HEALTH_PATH = "/health";

export const VAULT_ASSET_PATH = "/vault/asset";

export const HTML_FRAME_PATH = "/html-frame";

export const WS_PATH = "/ws";

export const healthResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const vaultAssetQuerySchema = z.object({ path: z.string().min(1) }).strict();

export const vaultAssetUrl = (origin: string, path: string): string =>
  `${origin}${VAULT_ASSET_PATH}?path=${encodeURIComponent(path)}`;

// the server names this value in connect-src and every client dials it; computed two ways, the browser refuses the socket
export const websocketOrigin = (httpOrigin: string): string => httpOrigin.replace(/^http/u, "ws");

export const workspaceSocketUrl = (httpOrigin: string): string =>
  `${websocketOrigin(httpOrigin)}${WS_PATH}`;

// a browser holds no bearer, so it signs in by opening a document URL carrying a single-use
// nonce: the server trades it for the session cookie and redirects to the same URL without it.
export const BROWSER_HANDOFF_PARAM = "handoff";

export const browserHandoffUrl = (url: string, nonce: string): string => {
  const target = new URL(url);
  target.searchParams.set(BROWSER_HANDOFF_PARAM, nonce);
  return target.toString();
};
