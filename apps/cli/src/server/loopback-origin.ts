// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// the one address the server binds and every client dials. never `localhost`: it resolves to ::1
// or 127.0.0.1 per machine, and those are different origins to the desktop's pin.
export const LOOPBACK_HOST = "127.0.0.1";

const LOCAL_HOSTS = [LOOPBACK_HOST, "localhost"] as const;

export const isLocalHostname = (hostname: string): boolean =>
  LOCAL_HOSTS.some((local) => local === hostname);

// a foreign hostname answers null: the server binds 127.0.0.1 only, and honoring
// one would let a DNS-rebinding page mint a matching Origin/Host pair. this
// answers which address, never who — a Host header authenticates nothing.
export const loopbackRequestOrigin = (host: string | undefined): string | null => {
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
  if (!isBareHost || !isLocalHostname(url.hostname)) {
    return null;
  }
  return url.origin;
};
