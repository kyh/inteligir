// the paths outside the rpc handler, none of which may acquire a typed client: /health is the
// harnesses' unauthenticated boot probe, /vault/asset answers bytes with an etag, a 304 and a
// policy per kind, /vault/page-copy a kept page under a script-less sandbox, /vault/thumb a
// cached card cover, /html-frame is the document a note's html block runs in under its own
// sandbox csp, and the /ws socket carries frames.

import { z } from "zod";

export const RPC_PREFIX = "/rpc";

export const HEALTH_PATH = "/health";

export const VAULT_ASSET_PATH = "/vault/asset";

export const HTML_FRAME_PATH = "/html-frame";

export const WS_PATH = "/ws";

export const healthResponseSchema = z.strictObject({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// GET ?path=&m=: a page copy (an .html file under PAGES_DIR) only
export const PAGE_COPY_PATH = "/vault/page-copy";

// GET ?path=&w=&m=: an image file kind only
export const VAULT_THUMB_PATH = "/vault/thumb";

export const THUMB_WIDTHS = [320, 640] as const;

// the boot's media token (system.status answers it). AVFoundation's loader inside WKWebView may
// send a video's range requests with neither Sec-Fetch-Site nor Origin, so the three byte routes,
// and no other, take a cookie request that names the token instead; the token alone is no
// credential.
export const MEDIA_TOKEN_PARAM = "m";

// `m` is MEDIA_TOKEN_PARAM, read by the route's guard, never by its handler
export const vaultAssetQuerySchema = z.strictObject({
  m: z.string().optional(),
  path: z.string().min(1),
});

export const vaultThumbQuerySchema = z.strictObject({
  m: z.string().optional(),
  path: z.string().min(1),
  w: z.enum(["320", "640"]),
});

const byteRouteUrl = (
  origin: string,
  route: string,
  path: string,
  mediaToken: string,
  extra = "",
): string =>
  `${origin}${route}?path=${encodeURIComponent(path)}${extra}&${MEDIA_TOKEN_PARAM}=${encodeURIComponent(mediaToken)}`;

export const vaultAssetUrl = (origin: string, path: string, mediaToken: string): string =>
  byteRouteUrl(origin, VAULT_ASSET_PATH, path, mediaToken);

export const pageCopyUrl = (origin: string, path: string, mediaToken: string): string =>
  byteRouteUrl(origin, PAGE_COPY_PATH, path, mediaToken);

export const vaultThumbUrl = (
  origin: string,
  path: string,
  width: (typeof THUMB_WIDTHS)[number],
  mediaToken: string,
): string => byteRouteUrl(origin, VAULT_THUMB_PATH, path, mediaToken, `&w=${String(width)}`);

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
