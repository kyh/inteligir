// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

const LOCAL_HOSTS = ["127.0.0.1", "localhost"] as const;

/**
 * Parse a Host header into the loopback origin it addresses, refusing
 * smuggled parts. Non-loopback hostnames return null: the server only binds
 * 127.0.0.1, and honoring a foreign hostname here would let a DNS-rebinding
 * page mint a matching Origin/Host pair.
 *
 * Two callers need the same answer to the same question — which loopback
 * address the caller actually reached — so the browser landings they redirect
 * to name the port this process is really on (`cloud/pair-callback.ts`,
 * `connectors/oauth-callback.ts`). One reading of a Host header, not two.
 *
 * This is all that survives of the origin heuristic that used to guard the
 * API. That guard passed every caller sending no Origin, which is every
 * non-browser caller — so it authenticated nothing and only narrowed which
 * PAGES could drive the server. The device token (`server-file.ts`) answers
 * the whole question instead, for browsers and non-browsers alike.
 */
export function loopbackRequestOrigin(host: string | undefined): string | null {
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
