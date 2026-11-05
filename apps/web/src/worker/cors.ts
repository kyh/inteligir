// The Mac app's page runs on the origin its shell serves it from (`MAC_APP_ORIGIN`), a page this
// Worker never served, so each call it makes to `/v1` is cross-origin and WebKit asks first. The
// Worker answers that one origin alone, on the routes the page calls, and lets in no credentials:
// the page sends its device credential as a bearer, never a cookie, so an origin let in reads
// nothing a session cookie would have opened. The socket is no CORS request (it opens on a ticket
// a call minted), and every other origin, the site's own pages included, meets no CORS header.

import { MAC_APP_ORIGIN } from "@repo/contract/cloud/origin";
import { CLIENT_BUILD_HEADER } from "@repo/contract/cloud/client-build";
import { V1_BLOBS_PATH, V1_EXPORTS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";

// the page's calls, its file uploads and the export it saves
const CROSS_ORIGIN_PREFIXES = [V1_RPC_PATH, V1_BLOBS_PATH, V1_EXPORTS_PATH].map(
  (path) => `${path}/`,
);

const ALLOWED_METHODS = "GET, HEAD, POST, PUT";
const ALLOWED_HEADERS = ["authorization", "content-type", CLIENT_BUILD_HEADER].join(", ");
// WebKit keeps a preflight's answer at most ten minutes, whatever a longer one asks
const PREFLIGHT_MAX_AGE_SECONDS = 600;

// the call is the Mac page's, on a route it may call across origins
export const fromMacPage = (request: Request, pathname: string): boolean =>
  request.headers.get("origin") === MAC_APP_ORIGIN &&
  CROSS_ORIGIN_PREFIXES.some((prefix) => pathname.startsWith(prefix));

const allowOrigin = (headers: Headers): void => {
  headers.set("access-control-allow-origin", MAC_APP_ORIGIN);
  headers.append("vary", "Origin");
};

// what the page reads of an answer beyond its body: an export's own name for itself
const EXPOSED_HEADERS = "content-disposition";

// what WebKit asks before the page's call: the methods and headers the page sends
export const answerPreflight = (): Response => {
  const headers = new Headers({
    "access-control-allow-headers": ALLOWED_HEADERS,
    "access-control-allow-methods": ALLOWED_METHODS,
    "access-control-max-age": String(PREFLIGHT_MAX_AGE_SECONDS),
  });
  allowOrigin(headers);
  return new Response(null, { headers, status: 204 });
};

// the answer the page reads, its own headers kept; a forwarded answer's are immutable, so it is
// copied
export const letMacPageRead = (response: Response): Response => {
  const headers = new Headers(response.headers);
  allowOrigin(headers);
  headers.set("access-control-expose-headers", EXPOSED_HEADERS);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
