import type { VaultChange } from "./sync-port";
import { isRecord } from "./guards";
import { isValidVaultPath, type VaultPath } from "./vault-file";

// ---------------------------------------------------------------------------
// wire.ts — the HTTP wire contract for vault sync.
//
// A PURE description of the HTTP surface the coordinator (the Cloudflare
// Worker in apps/web) exposes and the client (desktop, mobile) calls, so both
// ends build against ONE contract. NO fetch, NO server, NO I/O — only route
// shapes, header + content-type names, and a handful of pure build/parse
// helpers (the JSON bodies are the `SyncPort` result ADTs verbatim). Same
// purity rules as the rest of @repo/notes: no node, no dom, no `Buffer`, no
// clock, no crypto. Even `URL`/`URLSearchParams` are avoided (dom-lib types) —
// the helpers here parse plain strings so the module type-checks with
// `lib: ES2023`, `types: []`.
//
// ROUTE TABLE (the paths come from the builders below; the coordinator's
// `matchRoute` in apps/web mirrors this — it does not redefine it):
//   manifest    GET    /v1/vault/:vaultId/manifest
//   getFile     GET    /v1/vault/:vaultId/file?path=…
//   putFile     PUT    /v1/vault/:vaultId/file?path=…   (body = raw bytes)
//   deleteFile  DELETE /v1/vault/:vaultId/file?path=…
//   changes     GET    /v1/vault/:vaultId/changes       (SSE stream)
//   enrollOffer POST   /v1/vault/:vaultId/enroll-offer  (an enrolled device offers a join)
//   enroll      POST   /v1/vault/:vaultId/enroll        (the joining device redeems it)
//   devices     GET    /v1/vault/:vaultId/devices       (the roster)
//   revoke      POST   /v1/vault/:vaultId/revoke        (tombstone one device)
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
export type VaultSubResource =
  | "manifest"
  | "file"
  | "changes"
  | "enroll-offer"
  | "enroll"
  | "devices"
  | "revoke";

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

/** `POST /v1/vault/:vaultId/enroll-offer` — an enrolled device offers a join. */
export function enrollOfferPath(vaultId: string): string {
  return vaultPath(vaultId, "enroll-offer");
}

/** `POST /v1/vault/:vaultId/enroll` — the joining device redeems the offer. */
export function enrollPath(vaultId: string): string {
  return vaultPath(vaultId, "enroll");
}

/** `GET /v1/vault/:vaultId/devices` — the enrolled roster, tombstones included. */
export function devicesPath(vaultId: string): string {
  return vaultPath(vaultId, "devices");
}

/** `POST /v1/vault/:vaultId/revoke` — tombstone one device. */
export function revokePath(vaultId: string): string {
  return vaultPath(vaultId, "revoke");
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

/**
 * Pull the token out of an `Authorization` header value, or `null` when the
 * header is absent or isn't a non-empty bearer. The scheme match is
 * case-insensitive (RFC 7235 says it is).
 *
 * This exists so that every verifier reads the SAME raw header. The device
 * credential is checked twice — once statelessly in the Worker, once against
 * the roster in the Durable Object — and the tempting shortcut of having the
 * first stamp its conclusion into a header the second trusts turns one forged
 * request header into full vault access. Neither side takes a forwarded
 * verdict; both call this.
 */
export function parseBearer(headerValue: string | null): string | null {
  if (headerValue === null) return null;
  const scheme = "bearer ";
  if (headerValue.length <= scheme.length) return null;
  if (headerValue.slice(0, scheme.length).toLowerCase() !== scheme) return null;
  const token = headerValue.slice(scheme.length).trim();
  return token === "" ? null : token;
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

// ---- vault ids ------------------------------------------------------------
//
// A vaultId is SELF-CERTIFYING: it is the fingerprint of the founding device's
// public key, so "which vault is this" and "whose vault is this" are one
// question answered by one SHA-256. Claiming someone else's id is a preimage
// problem, not a race to be first.
//
// The digest is injected rather than computed here — @repo/notes carries no
// crypto, exactly as `Hasher` already establishes for content hashing.

/** Every vaultId minted under the device-key model starts with this. */
export const VAULT_ID_PREFIX = "v1";

/** `v1` + base32 of a 32-byte digest: 2 + ceil(256/5) = 54 characters. */
const VAULT_ID_SHAPE = /^v1[a-z2-7]{52}$/;

const SHA256_DIGEST_BYTES = 32;

/**
 * True for an id of the self-certifying shape. Load-bearing on the Worker's
 * unauthenticated enroll route: without it a caller instantiates Durable
 * Objects by naming arbitrary strings.
 */
export function isValidVaultId(id: string): boolean {
  return VAULT_ID_SHAPE.test(id);
}

/**
 * Derive the vaultId a device's key founds, from the SHA-256 of that device's
 * RAW public key bytes. `null` when the digest isn't 32 bytes — the caller
 * handed us something that is not a SHA-256.
 */
export function vaultIdFromKeyDigest(digest: Uint8Array): string | null {
  if (digest.length !== SHA256_DIGEST_BYTES) return null;
  return VAULT_ID_PREFIX + base32LowerEncode(digest);
}

// ---- device enrollment bodies ---------------------------------------------
//
// Growth is by signature, never by server grant: only an already-enrolled
// device can offer a join, and the offer's SECRET never reaches the server —
// only `sha256hex(secret)`. Redeeming is therefore unauthenticated by design,
// because the secret IS the auth.

/** One row of the roster. `revokedAt` non-null is a tombstone, never a delete. */
export type DeviceRecord = {
  /** base64url of the raw Ed25519 public key — the roster's primary key. */
  readonly publicKey: string;
  readonly name: string;
  readonly enrolledAt: number;
  readonly revokedAt: number | null;
};

/** `GET …/devices` — every enrolled key, revoked ones included. */
export type DeviceListResponse = { readonly devices: readonly DeviceRecord[] };

/** `POST …/enroll-offer` body. `enrollId` is `sha256hex(secret)`, lowercase. */
export type EnrollOfferRequest = {
  readonly enrollId: string;
  /** Epoch seconds. The coordinator clamps it to its own maximum TTL. */
  readonly notAfter: number;
};

/** `POST …/enroll-offer` result — the offer's effective (clamped) expiry. */
export type EnrollOfferResponse = { readonly notAfter: number };

/**
 * Shortest offer secret a coordinator accepts, in raw bytes — and the length a
 * device must MINT at. The server holds only `sha256hex(secret)`, so a short
 * secret is brute-forceable offline against a live offer. Randomness is not
 * checkable server-side; length is, so the floor is enforced at both ends.
 */
export const MIN_ENROLL_SECRET_BYTES = 32;

/**
 * `POST …/enroll` body. `s` is base64url of the offer secret, named to match
 * the pairing blob field the joining device forwards verbatim. Mint it as
 * `MIN_ENROLL_SECRET_BYTES` (or more) of CSPRNG output.
 */
export type EnrollRequest = {
  readonly s: string;
  /** base64url of the joining device's raw Ed25519 public key. */
  readonly publicKey: string;
  readonly deviceName: string;
};

/**
 * `POST …/enroll` result. Deliberately carries NO reason: wrong secret, expired
 * offer and already-consumed offer answer identically, so the route is not an
 * offer-existence oracle.
 */
export type EnrollResponse = { readonly ok: boolean };

/** `POST …/revoke` body. Any enrolled device may revoke any device, itself included. */
export type RevokeRequest = { readonly publicKey: string };

/**
 * `POST …/revoke` result. `last-device` is a refusal, not a failure: a
 * tombstone is permanent and a vault with no live device can neither
 * authenticate nor enroll (an offer needs an enrolled signer), so the
 * coordinator will not perform the one revoke that strands it. Clients render
 * that as "disconnect this vault" rather than as a retryable error.
 */
export type RevokeResponse =
  | { readonly ok: true; readonly revokedAt: number }
  | { readonly ok: false; readonly reason: "not-found" | "last-device" };

// ---- pairing blob ---------------------------------------------------------
//
// The one string that crosses from the offering device to the joining one, by
// hand (pasted, not scanned — QR is a later, separate change). It carries the
// three things the joiner cannot derive: which coordinator, which vault, and
// the offer secret that authorizes the enrollment.
//
// It is a LIVE CAPABILITY for the offer's lifetime, which is why it travels in
// a POST body from there on and never in a URL. Encoded as one opaque token
// rather than readable fields so it survives a paste intact and reads as a
// secret rather than as configuration worth keeping.

/** The claims a pairing blob carries. `s` matches `EnrollRequest.s` — the
 * joining device forwards it verbatim. */
export type PairingBlob = {
  readonly v: typeof DEVICE_ASSERTION_VERSION;
  /** Coordinator origin the joining device will call, e.g. `https://…workers.dev`. */
  readonly url: string;
  readonly vid: string;
  /** base64url of the offer secret — at least `MIN_ENROLL_SECRET_BYTES`. */
  readonly s: string;
};

/** base64url the blob's JSON, or `null` when it isn't well-formed (the same
 * predicate the parse side applies, so this cannot emit an unparseable blob). */
export function formatPairingBlob(blob: PairingBlob): string | null {
  if (parsePairingClaims(blob) === null) return null;
  return base64UrlEncode(asciiBytes(JSON.stringify(blob)));
}

/** Decode a pasted blob, or `null` for anything malformed. Surrounding
 * whitespace is tolerated: this arrives through a clipboard. */
export function parsePairingBlob(text: string): PairingBlob | null {
  const bytes = base64UrlDecode(text.trim());
  if (bytes === null) return null;
  const json = asciiText(bytes);
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return parsePairingClaims(raw);
}

// ---- base32 ---------------------------------------------------------------

const BASE32_LOWER_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * Encode bytes as unpadded lowercase base32 (RFC 4648 §6). Lowercase and
 * digit-restricted so a vaultId survives a case-insensitive filesystem, a URL
 * path segment and a hand transcription without changing meaning.
 */
export function base32LowerEncode(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_LOWER_ALPHABET.charAt((acc >> bits) & 0b11111);
    }
  }
  if (bits > 0) out += BASE32_LOWER_ALPHABET.charAt((acc << (5 - bits)) & 0b11111);
  return out;
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

/**
 * Validate untrusted claims into a `PairingBlob`. The url is held to printable
 * ASCII under an http(s) scheme: a joining device turns it straight into a
 * request, and the JSON has to stay ASCII for the codec above. The secret's
 * LENGTH is checked here as well as at the coordinator — a blob short enough to
 * be searched against a live offer is malformed, not merely unlucky.
 */
function parsePairingClaims(raw: unknown): PairingBlob | null {
  if (!isRecord(raw)) return null;
  const { v, url, vid, s } = raw;
  if (v !== DEVICE_ASSERTION_VERSION) return null;
  if (typeof url !== "string" || !/^https?:\/\/[\x21-\x7e]+$/.test(url)) return null;
  if (typeof vid !== "string" || !isValidVaultId(vid)) return null;
  if (typeof s !== "string") return null;
  const secret = base64UrlDecode(s);
  if (secret === null || secret.length < MIN_ENROLL_SECRET_BYTES) return null;
  return { v: DEVICE_ASSERTION_VERSION, url, vid, s };
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
