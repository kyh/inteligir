import type { VaultChange } from "./sync-port";
import { isValidVaultPath, type VaultPath } from "./vault-file";

// ---------------------------------------------------------------------------
// wire.ts — the HTTP wire contract for vault sync.
//
// A PURE description of the HTTP surface the coordinator (the Cloudflare
// Worker in apps/cloud) exposes and the client (desktop, mobile) calls, so both
// ends build against ONE contract. NO fetch, NO server, NO I/O — only route
// shapes, header + content-type names, and a handful of pure build/parse
// helpers (the JSON bodies are the `SyncPort` result ADTs verbatim). Same
// purity rules as the rest of @repo/notes: no node, no dom, no `Buffer`, no
// clock, no crypto. Even `URL`/`URLSearchParams` are avoided (dom-lib types) —
// the helpers here parse plain strings so the module type-checks with
// `lib: ES2023`, `types: []`.
//
// ROUTE TABLE (the paths come from the builders below; the coordinator's
// `matchRoute` in apps/cloud mirrors this — it does not redefine it):
//   manifest    GET    /v1/vault/:vaultId/manifest
//   getFile     GET    /v1/vault/:vaultId/file?path=…
//   putFile     PUT    /v1/vault/:vaultId/file?path=…   (body = raw bytes)
//   deleteFile  DELETE /v1/vault/:vaultId/file?path=…
//   changes     GET    /v1/vault/:vaultId/changes       (SSE stream)
//
// TRANSPORT SHAPE
//   File bodies are RAW BYTES (`Content-Type: application/octet-stream`): the
//   GET-file route returns them, the PUT-file route sends them. Only the
//   metadata routes (manifest, put/delete results) carry JSON. The `changes`
//   route is Server-Sent Events (`text/event-stream`) — Worker-friendly and
//   parsed by a stock `EventSource` on the client.
//
//   Optimistic concurrency rides in the `x-base-version` request header (a
//   PUT/DELETE carries the version it last saw); a conflict comes back IN THE
//   BODY as an `ok: false` envelope (HTTP 200), never as an HTTP error — a
//   conflict is a value, mirroring `SyncPort`. Status codes are otherwise:
//   200 on success, 404 when GET-file misses (no body to return), 401 on an
//   auth failure (transport-level, outside the sync ADTs).
// ---------------------------------------------------------------------------

/** The API version prefix every route shares. Bump on a breaking wire change. */
export const API_VERSION = "v1";

// ---- routes ---------------------------------------------------------------

/** The vault-scoped sub-resources, i.e. the last path segment of a route. */
export type VaultSubResource = "manifest" | "file" | "changes";

/** The query-string key the file routes carry the vault path in (`?path=…`). */
export const FILE_PATH_PARAM = "path";

/**
 * Build a vault-scoped route path, e.g.
 * `vaultPath("abc", "manifest")` → `"/v1/vault/abc/manifest"`. `vaultId` is
 * percent-encoded so an odd id can't break out of the path segment.
 */
export function vaultPath(vaultId: string, sub: VaultSubResource): string {
  return `/${API_VERSION}/vault/${encodeURIComponent(vaultId)}/${sub}`;
}

/** `GET /v1/vault/:vaultId/manifest`. */
export function manifestPath(vaultId: string): string {
  return vaultPath(vaultId, "manifest");
}

/**
 * The file route path (shared by GET/PUT/DELETE), with the vault path carried as
 * a percent-encoded `?path=` query param, e.g.
 * `filePath("abc", "notes/todo.md")` → `"/v1/vault/abc/file?path=notes%2Ftodo.md"`.
 */
export function filePath(vaultId: string, path: VaultPath): string {
  return `${vaultPath(vaultId, "file")}?${FILE_PATH_PARAM}=${encodeURIComponent(path)}`;
}

/** `GET /v1/vault/:vaultId/changes` — the SSE change stream. */
export function changesPath(vaultId: string): string {
  return vaultPath(vaultId, "changes");
}

/**
 * Extract the vault path from a file-route query string (the part after `?`,
 * with or without the leading `?`). Returns the decoded `VaultPath`, or `null`
 * when the `path` param is absent, empty, or percent-decodes badly — parse at
 * the boundary rather than trust the wire.
 */
export function parseFilePathParam(search: string): VaultPath | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq) !== FILE_PATH_PARAM) continue;
    const raw = pair.slice(eq + 1);
    if (raw === "") return null;
    try {
      const decoded = decodeURIComponent(raw);
      // The coordinator persists this path (an R2 key + a manifest entry
      // re-served to every client), so reject a traversal/escape shape here
      // rather than store one a client must defend against — the same
      // VaultPath contract parseVaultFile enforces on the pull side.
      return isValidVaultPath(decoded) ? decoded : null;
    } catch {
      return null; // malformed percent-encoding
    }
  }
  return null;
}

// ---- headers --------------------------------------------------------------

/**
 * Request header carrying the optimistic-concurrency token on PUT/DELETE: the
 * coordinator version the write is based on (`ABSENT_VERSION` = 0 for a create).
 * Mirrors `SyncPort.putFile`/`deleteFile`'s `expectedBaseVersion`.
 */
export const HEADER_BASE_VERSION = "x-base-version";

/** Response header on a successful GET/PUT: the file's now-current version. */
export const HEADER_VERSION = "x-vault-version";

/** Response header on a successful GET/PUT: the file's `contentHash`. */
export const HEADER_CONTENT_HASH = "x-vault-content-hash";

/** The authorization request header (`Authorization: Bearer <token>`). */
export const HEADER_AUTHORIZATION = "authorization";

/** Format a non-negative integer version as its header string. */
export function formatVersionHeader(version: number): string {
  return String(version);
}

/**
 * Parse a version header value (e.g. `x-base-version`) into a non-negative
 * integer. Returns `null` for a missing header or any non-`/^\d+$/`, unsafe, or
 * out-of-range value — parse at the boundary rather than trust the wire.
 */
export function parseVersionHeader(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** Format a bearer authorization header value: `formatBearer(t)` → `"Bearer <t>"`. */
export function formatBearer(token: string): string {
  return `Bearer ${token}`;
}

// ---- content types --------------------------------------------------------

/** `Content-Type` for file bodies (GET/PUT): raw, opaque bytes. */
export const CONTENT_TYPE_OCTET_STREAM = "application/octet-stream";

/** `Content-Type` for the `changes` route: a Server-Sent Events stream. */
export const CONTENT_TYPE_SSE = "text/event-stream";

// ---- SSE change frames ----------------------------------------------------

/** The SSE `event:` name every frame on the `changes` stream uses. */
export const SSE_CHANGE_EVENT = "change";

/**
 * Serialize a `VaultChange` as a single SSE frame (`event:` + `data:` lines and
 * the blank-line terminator) for the coordinator to write to the `changes`
 * stream. Pure string building — the caller owns the actual stream write.
 */
export function formatChangeFrame(change: VaultChange): string {
  return `event: ${SSE_CHANGE_EVENT}\ndata: ${JSON.stringify(change)}\n\n`;
}
