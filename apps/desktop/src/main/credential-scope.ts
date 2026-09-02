import { join, normalize, resolve } from "node:path";
import { RPC_PREFIX, VAULT_ASSET_PATH } from "@repo/api/local/routes";
import { pathContains } from "inteligir/server/path-containment";

// the set the protocol handler forwards, and so the set the bearer is attached to.
export function isProxiedPath(pathname: string): boolean {
  return pathname.startsWith(`${RPC_PREFIX}/`) || pathname === VAULT_ASSET_PATH;
}

// containment is checked on the resolved path: `%2e%2e` is `..` once decoded.
export function bundleFile(dir: string, pathname: string): string | null {
  const root = resolve(dir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = resolve(join(root, normalize(decoded)));
  return pathContains(root, candidate) ? candidate : null;
}

// only the websockets: every other request arrives through the protocol handler, which attaches the bearer in main.
export function socketCredentialFilter(serverOrigin: string): string[] {
  return [`ws://${new URL(serverOrigin).host}/*`];
}
