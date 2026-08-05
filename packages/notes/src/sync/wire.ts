import type { VaultChange } from "./sync-port";
import { isRecord } from "./guards";
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

// ---- device assertions ----------------------------------------------------
//
// The bearer credential is a SELF-ISSUED, short-lived device assertion: a
// device proves it holds an Ed25519 private key rather than presenting a token
// some server minted for it.
//
//   encodedPayload = base64url(JSON DeviceAssertionPayload)     (ASCII)
//   assertion      = encodedPayload + "." + base64url(signature)
//   signature      = Ed25519 over `deviceAssertionSignedBytes(encodedPayload)`
//
// Only the ENCODING lives here. Signing and verifying are platform-injected —
// node crypto, @noble/ed25519, WebCrypto — exactly the seam `Hasher` already
// uses for content hashing, which is what keeps this package crypto-free.
//
// The codecs below are hand-rolled for the same reason `URL` is avoided above:
// the module carries no global beyond the ES2023 stdlib, so it behaves
// identically on Hermes, workerd and node. There is nothing to polyfill.

/** The only `v` a payload may carry. Bump alongside `DEVICE_ASSERTION_DOMAIN`. */
export const DEVICE_ASSERTION_VERSION = 1;

/**
 * Domain-separation prefix over the signed bytes. A device key signs more than
 * assertions (an enrollment offer, say), and this prefix is what stops one
 * signature ever being replayable as another.
 */
export const DEVICE_ASSERTION_DOMAIN = "inteligir-device-v1:";

/** Raw Ed25519 public key length — a `dev` decoding to anything else isn't one. */
export const ED25519_PUBLIC_KEY_BYTES = 32;

/** Raw Ed25519 signature length. */
export const ED25519_SIGNATURE_BYTES = 64;

/** The claims a device asserts about itself. Timestamps are epoch SECONDS. */
export type DeviceAssertionPayload = {
  readonly v: typeof DEVICE_ASSERTION_VERSION;
  /** The vault this assertion is bound to — a verifier matches it to the route. */
  readonly vid: string;
  /** base64url of the raw Ed25519 public key whose signature this carries. */
  readonly dev: string;
  readonly iat: number;
  readonly exp: number;
};

/** A parsed assertion: the claims, plus every byte string a verifier needs. */
export type DeviceAssertion = {
  readonly payload: DeviceAssertionPayload;
  /** Exactly the bytes the signature covers. */
  readonly signedBytes: Uint8Array;
  readonly signature: Uint8Array;
  /** Raw public key bytes — the decoded `payload.dev`, so verifiers need no second decode. */
  readonly devicePublicKey: Uint8Array;
};

/**
 * base64url the payload's JSON, or `null` when the payload isn't well-formed
 * (the same predicate the parse side applies, so this can never emit a string
 * `parseDeviceAssertionPayload` would reject).
 */
export function encodeDeviceAssertionPayload(payload: DeviceAssertionPayload): string | null {
  if (parseDeviceAssertionClaims(payload) === null) return null;
  return base64UrlEncode(asciiBytes(JSON.stringify(payload)));
}

/** Decode an encoded payload back into claims, or `null` if anything is off. */
export function parseDeviceAssertionPayload(encoded: string): DeviceAssertionPayload | null {
  const bytes = base64UrlDecode(encoded);
  if (bytes === null) return null;
  const json = asciiText(bytes);
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return parseDeviceAssertionClaims(raw);
}

/**
 * The bytes a signer signs and a verifier verifies. Returned as bytes rather
 * than a string so no crypto call site has to decide on an encoding.
 */
export function deviceAssertionSignedBytes(encodedPayload: string): Uint8Array {
  return asciiBytes(DEVICE_ASSERTION_DOMAIN + encodedPayload);
}

/** Join an encoded payload and its raw signature into the bearer string. */
export function formatDeviceAssertion(encodedPayload: string, signature: Uint8Array): string {
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

/**
 * Parse a bearer string into a `DeviceAssertion`, or `null` for anything
 * malformed. It proves SHAPE only — the signature is unchecked here, and so are
 * expiry and vault binding, all of which belong to the verifier's policy.
 */
export function parseDeviceAssertion(raw: string): DeviceAssertion | null {
  const dot = raw.indexOf(".");
  if (dot === -1 || raw.indexOf(".", dot + 1) !== -1) return null;
  const encodedPayload = raw.slice(0, dot);
  const payload = parseDeviceAssertionPayload(encodedPayload);
  if (payload === null) return null;
  const signature = base64UrlDecode(raw.slice(dot + 1));
  if (signature === null || signature.length !== ED25519_SIGNATURE_BYTES) return null;
  const devicePublicKey = base64UrlDecode(payload.dev);
  if (devicePublicKey === null) return null;
  return {
    payload,
    signedBytes: deviceAssertionSignedBytes(encodedPayload),
    signature,
    devicePublicKey,
  };
}

// ---- base64url ------------------------------------------------------------

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Both codecs shift into a 32-bit `acc` that overflows on any input longer than
// a few bytes. Only its low 13 bits are ever read back — one group plus the
// carry — so the high bits JS discards were never going to be looked at.

/** Encode bytes as unpadded base64url (RFC 4648 §5). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64URL_ALPHABET.charAt((acc >> bits) & 0b111111);
    }
  }
  if (bits > 0) out += BASE64URL_ALPHABET.charAt((acc << (6 - bits)) & 0b111111);
  return out;
}

/**
 * Decode unpadded base64url, or `null` for a foreign character, an impossible
 * length, or non-zero trailing bits. That last check is what makes the encoding
 * canonical: one byte string has exactly one spelling, so nobody can mutate an
 * assertion's text without changing what it decodes to.
 */
export function base64UrlDecode(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const bytes = new Uint8Array((text.length * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let out = 0;
  for (const char of text) {
    const value = BASE64URL_ALPHABET.indexOf(char);
    if (value === -1) return null;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out] = (acc >> bits) & 0xff;
      out += 1;
    }
  }
  if ((acc & ((1 << bits) - 1)) !== 0) return null;
  return bytes;
}

// ---- internals ------------------------------------------------------------

/**
 * Validate untrusted claims into a `DeviceAssertionPayload`. `vid` is held to a
 * conservative opaque-id alphabet rather than any particular vault-id shape —
 * that binding is the verifier's job — but it must be ASCII, because that plus
 * the numeric and base64url fields is what makes the serialized JSON ASCII.
 */
function parseDeviceAssertionClaims(raw: unknown): DeviceAssertionPayload | null {
  if (!isRecord(raw)) return null;
  const { v, vid, dev, iat, exp } = raw;
  if (v !== DEVICE_ASSERTION_VERSION) return null;
  if (typeof vid !== "string" || !/^[A-Za-z0-9_-]+$/.test(vid)) return null;
  if (typeof dev !== "string") return null;
  const publicKey = base64UrlDecode(dev);
  if (publicKey === null || publicKey.length !== ED25519_PUBLIC_KEY_BYTES) return null;
  if (!isEpochSeconds(iat) || !isEpochSeconds(exp) || exp <= iat) return null;
  return { v: DEVICE_ASSERTION_VERSION, vid, dev, iat, exp };
}

function isEpochSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** ASCII text → bytes. Every caller feeds it validated-ASCII text (see
 * `parseDeviceAssertionClaims`), which is what spares this module a UTF-8 codec. */
function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Bytes → ASCII text, or `null` if any byte is outside ASCII. */
function asciiText(bytes: Uint8Array): string | null {
  let text = "";
  for (const byte of bytes) {
    if (byte > 0x7f) return null;
    text += String.fromCharCode(byte);
  }
  return text;
}
