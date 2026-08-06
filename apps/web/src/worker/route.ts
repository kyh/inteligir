import { API_VERSION, parseFilePathParam } from "@repo/notes/sync/wire";
import type { VaultPath } from "@repo/notes/sync/vault-file";

// ---------------------------------------------------------------------------
// Route matching for the vault-sync wire contract. Parses an incoming
// `(method, pathname, search)` into a typed `RouteMatch` — the ADT the worker
// (to pick the DO) and the DO (to dispatch) both switch over. Mirrors the route
// table documented in `@repo/notes/sync/wire`'s header comment; it does NOT
// redefine it.
//
//   GET    /v1/vault/:vaultId/manifest        -> manifest
//   GET    /v1/vault/:vaultId/file?path=…      -> getFile
//   PUT    /v1/vault/:vaultId/file?path=…      -> putFile
//   DELETE /v1/vault/:vaultId/file?path=…      -> deleteFile
//   GET    /v1/vault/:vaultId/changes          -> changes
//   POST   /v1/vault/:vaultId/enroll-offer     -> enrollOffer
//   POST   /v1/vault/:vaultId/enroll           -> enroll
//   GET    /v1/vault/:vaultId/devices          -> devices
//   POST   /v1/vault/:vaultId/revoke           -> revoke
// ---------------------------------------------------------------------------

/** A parsed request against the sync contract. `bad-file-path` = a file route
 *  whose `?path=` param is missing/malformed (a 400); `unmatched` = not a sync
 *  route at all (a 404). Both file-typed matches carry the decoded `VaultPath`. */
export type RouteMatch =
  | { readonly kind: "manifest"; readonly vaultId: string }
  | { readonly kind: "getFile"; readonly vaultId: string; readonly path: VaultPath }
  | { readonly kind: "putFile"; readonly vaultId: string; readonly path: VaultPath }
  | { readonly kind: "deleteFile"; readonly vaultId: string; readonly path: VaultPath }
  | { readonly kind: "changes"; readonly vaultId: string }
  | { readonly kind: "enrollOffer"; readonly vaultId: string }
  | { readonly kind: "enroll"; readonly vaultId: string }
  | { readonly kind: "devices"; readonly vaultId: string }
  | { readonly kind: "revoke"; readonly vaultId: string }
  | { readonly kind: "bad-file-path"; readonly vaultId: string }
  | { readonly kind: "unmatched" };

/** A match that names a vault — everything but `unmatched`. */
export type VaultRouteMatch = Exclude<RouteMatch, { readonly kind: "unmatched" }>;

/**
 * The device-identity routes, as opposed to the five sync routes. They are
 * reachable ONLY with a device credential (`enroll` with an offer secret, the
 * rest with an assertion) — a Better Auth session authorizes sync and nothing
 * else, so the two identity models never reach into each other.
 */
export function isDeviceRoute(match: RouteMatch): boolean {
  return (
    match.kind === "enrollOffer" ||
    match.kind === "enroll" ||
    match.kind === "devices" ||
    match.kind === "revoke"
  );
}

const UNMATCHED: RouteMatch = { kind: "unmatched" };

/** Match a request path against the sync routes. Pure — no I/O, no bindings. */
export function matchRoute(method: string, pathname: string, search: string): RouteMatch {
  // Expect exactly `/${API_VERSION}/vault/:vaultId/:sub` -> 5 split segments,
  // the first empty (leading slash).
  const segments = pathname.split("/");
  if (segments.length !== 5) return UNMATCHED;
  const [lead, version, vaultLiteral, rawVaultId, sub] = segments;
  if (lead !== "" || version !== API_VERSION || vaultLiteral !== "vault") return UNMATCHED;
  if (rawVaultId === undefined || rawVaultId === "" || sub === undefined) return UNMATCHED;

  let vaultId: string;
  try {
    vaultId = decodeURIComponent(rawVaultId);
  } catch {
    return UNMATCHED; // malformed percent-encoding in the vault id segment
  }
  if (vaultId === "") return UNMATCHED;

  if (sub === "manifest") {
    return method === "GET" ? { kind: "manifest", vaultId } : UNMATCHED;
  }
  if (sub === "changes") {
    return method === "GET" ? { kind: "changes", vaultId } : UNMATCHED;
  }
  if (sub === "enroll-offer") {
    return method === "POST" ? { kind: "enrollOffer", vaultId } : UNMATCHED;
  }
  if (sub === "enroll") {
    return method === "POST" ? { kind: "enroll", vaultId } : UNMATCHED;
  }
  if (sub === "devices") {
    return method === "GET" ? { kind: "devices", vaultId } : UNMATCHED;
  }
  if (sub === "revoke") {
    return method === "POST" ? { kind: "revoke", vaultId } : UNMATCHED;
  }
  if (sub === "file") {
    const path = parseFilePathParam(search);
    if (path === null) return { kind: "bad-file-path", vaultId };
    if (method === "GET") return { kind: "getFile", vaultId, path };
    if (method === "PUT") return { kind: "putFile", vaultId, path };
    if (method === "DELETE") return { kind: "deleteFile", vaultId, path };
    return UNMATCHED;
  }
  return UNMATCHED;
}
