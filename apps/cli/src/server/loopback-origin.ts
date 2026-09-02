// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

const LOCAL_HOSTS = ["127.0.0.1", "localhost"] as const;

// a foreign hostname answers null: the server binds 127.0.0.1 only, and honoring
// one would let a DNS-rebinding page mint a matching Origin/Host pair. this
// answers which address, never who — a Host header authenticates nothing.
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
