// WHERE THE DEVICE TOKEN GOES, and where the bundle's bytes may come from.
//
// The origin pin decides what the window may LOAD; these decide what the shell
// attaches a credential to and which files it will serve. Both are security
// rules, so both are pure and tested here rather than living as helpers inside
// the Electron modules that call them.

import { join, normalize, resolve } from "node:path";
import { RPC_PREFIX, VAULT_ASSET_PATH } from "@repo/api/local/routes";
import { pathContains } from "inteligir/server/path-containment";

/**
 * Paths the protocol handler forwards to the local server — and so the exact
 * set it attaches the bearer to. Everything else is answered from the bundle
 * and never sees a credential.
 */
export function isProxiedPath(pathname: string): boolean {
  return pathname.startsWith(`${RPC_PREFIX}/`) || pathname === VAULT_ASSET_PATH;
}

/**
 * A bundle path as a file inside `dir`, or null for anything that climbs out
 * of it. Containment is checked on the RESOLVED path rather than on the URL,
 * because `%2e%2e` is a `..` the moment the URL parser has decoded it.
 */
export function bundleFile(dir: string, pathname: string): string | null {
  const root = resolve(dir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A lone `%` is not a path this bundle holds.
    return null;
  }
  const candidate = resolve(join(root, normalize(decoded)));
  return pathContains(root, candidate) ? candidate : null;
}

/**
 * The `onBeforeSendHeaders` filter the bearer is attached under. Scoped to the
 * server's own ws origin, so nothing else the window ever reaches sees a
 * credential — and only the websockets, because every other request already
 * arrives through the protocol handler, which attaches it in main.
 */
export function socketCredentialFilter(serverOrigin: string): string[] {
  return [`ws://${new URL(serverOrigin).host}/*`];
}
