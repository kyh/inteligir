// Two pages this Worker never served call `/v1` across origins: the Mac app's, on the origin its
// shell serves it from (`MAC_APP_ORIGIN`), and the browser extension's service worker, on its own
// (`EXTENSION_ORIGIN`), which asks no host permission. Each is answered on the routes it calls and
// on those alone, by its own exact origin, never a reflected one, and with no credentials: each
// sends its device credential as a bearer, never a cookie, so an origin let in reads nothing a
// session cookie would have opened. The socket is no CORS request (it opens on a ticket a call
// minted), and every other origin, the site's own pages included, meets no CORS header.

import { MAC_APP_ORIGIN } from "@repo/contract/cloud/origin";
import { CLIENT_BUILD_HEADER } from "@repo/contract/cloud/client-build";
import { EXTENSION_ORIGIN } from "@repo/contract/cloud/extension/extension-identity";
import { V1_BLOBS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";

// each page's calls: the Mac page's file uploads, the extension's covers and the pictures a
// right-click saves
const CROSS_ORIGIN_ROUTES = new Map<string, readonly string[]>([
  [MAC_APP_ORIGIN, [V1_RPC_PATH, V1_BLOBS_PATH]],
  [EXTENSION_ORIGIN, [V1_RPC_PATH, V1_BLOBS_PATH]],
]);

const ALLOWED_METHODS = "GET, HEAD, POST, PUT";
const ALLOWED_HEADERS = ["authorization", "content-type", CLIENT_BUILD_HEADER].join(", ");
// WebKit keeps a preflight's answer at most ten minutes, whatever a longer one asks
const PREFLIGHT_MAX_AGE_SECONDS = 600;

// the origin of a page let in on this route, or null for any other call
export const crossOriginPage = (request: Request, pathname: string): string | null => {
  const origin = request.headers.get("origin");
  const routes = origin === null ? undefined : CROSS_ORIGIN_ROUTES.get(origin);
  return origin !== null && routes?.some((route) => pathname.startsWith(`${route}/`)) === true
    ? origin
    : null;
};

const allowOrigin = (headers: Headers, origin: string): void => {
  headers.set("access-control-allow-origin", origin);
  headers.append("vary", "Origin");
};

// what the browser asks before the page's call: the methods and headers the page sends
export const answerPreflight = (origin: string): Response => {
  const headers = new Headers({
    "access-control-allow-headers": ALLOWED_HEADERS,
    "access-control-allow-methods": ALLOWED_METHODS,
    "access-control-max-age": String(PREFLIGHT_MAX_AGE_SECONDS),
  });
  allowOrigin(headers, origin);
  return new Response(null, { headers, status: 204 });
};

// the answer the page reads, its own headers kept; a forwarded answer's are immutable, so it is
// copied
export const letPageRead = (response: Response, origin: string): Response => {
  const headers = new Headers(response.headers);
  allowOrigin(headers, origin);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
