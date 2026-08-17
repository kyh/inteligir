// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

/**
 * Guards privileged local boundaries (/api/v1 and the /ws upgrade) without
 * imposing credentials on non-browser clients. Browsers send Origin; the CLI,
 * SDKs and server-to-server callers commonly do not — so a request carrying a
 * browser Origin must name one of this app's OWN origins, and a request
 * carrying none passes. Without this, any webpage open in the user's browser
 * could drive the loopback API and subscribe to the ws bus.
 *
 * "Own origins" are the configured port's `127.0.0.1`/`localhost` variants
 * (browsers treat the two as distinct origins) plus the origin the request
 * itself was addressed to (its Host header) — the server may end up bound to
 * a probed port when the derived one is taken, and the page it serves calls
 * back on the port it was loaded from. A hostile page cannot exploit the
 * Host match: a browser sets Host to the connect target, so a cross-site
 * request always carries the foreign page's Origin against our own Host.
 *
 * Origin alone does not cover a SUBRESOURCE load: a browser sends no Origin
 * for `<img src>`, `<script src>` or `<link>`, so a hostile page that guessed
 * the port could point an `<img>` at a vault asset. It could not read the
 * pixels (the canvas taints), but load-vs-error already discloses that a path
 * exists. `Sec-Fetch-Site` is what closes it, and only its `cross-site` value
 * is acted on: same-origin app traffic sends `same-origin`, a user typing the
 * URL sends `none`, and every non-browser caller sends nothing at all — so
 * this refuses exactly the case Origin cannot see and widens nothing.
 */

export interface BrowserRequestHeaders {
  host: string | undefined;
  origin: string | undefined;
  /** The browser's own account of who initiated the request; absent outside
   *  browsers, and absent in browsers old enough not to send it. */
  secFetchSite: string | undefined;
}

const LOCAL_HOSTS = ["127.0.0.1", "localhost"] as const;

export function buildLocalAppOrigins(port: number): ReadonlySet<string> {
  return new Set(LOCAL_HOSTS.map((host) => `http://${host}:${port}`));
}

/**
 * Parse a Host header into the loopback origin it addresses, refusing
 * smuggled parts. Non-loopback hostnames return null: the server only binds
 * 127.0.0.1, and honoring a foreign hostname here would let a DNS-rebinding
 * page mint a matching Origin/Host pair.
 */
function requestTargetOrigin(host: string | undefined): string | null {
  if (host === undefined || host.length === 0) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return null;
  }
  const isBareHost =
    url.username.length === 0 &&
    url.password.length === 0 &&
    url.pathname === "/" &&
    url.search.length === 0 &&
    url.hash.length === 0;
  if (!isBareHost || !LOCAL_HOSTS.some((local) => local === url.hostname)) {
    return null;
  }
  return url.origin;
}

function isTrustedOrigin(
  origin: string,
  headers: BrowserRequestHeaders,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  // A serialized origin is exactly `scheme://host[:port]` — anything else
  // (paths, credentials, a raw "null") must not slip past the set lookup.
  if (
    originUrl.origin !== origin ||
    (originUrl.protocol !== "http:" && originUrl.protocol !== "https:")
  ) {
    return false;
  }
  if (allowedOrigins.has(originUrl.origin)) {
    return true;
  }
  const target = requestTargetOrigin(headers.host);
  return target !== null && target === originUrl.origin;
}

/** The refusal message, or null for a trusted request; the caller owns the 403. */
export function browserRequestProblem(
  headers: BrowserRequestHeaders,
  allowedOrigins: ReadonlySet<string>,
): string | null {
  if (headers.origin !== undefined && !isTrustedOrigin(headers.origin, headers, allowedOrigins)) {
    return `origin "${headers.origin}" is not a local inteligir app origin`;
  }
  if (headers.secFetchSite === "cross-site") {
    return "a cross-site request cannot reach the local inteligir app";
  }
  return null;
}
