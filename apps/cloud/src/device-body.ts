import { isRecord } from "@repo/notes/sync/guards";
import {
  base64UrlDecode,
  ED25519_PUBLIC_KEY_BYTES,
  type EnrollOfferRequest,
  type EnrollRequest,
  type RevokeRequest,
} from "@repo/notes/sync/wire";

// ---------------------------------------------------------------------------
// Boundary parsers for the device-identity request bodies. Nothing here trusts
// the wire: each returns the typed body or `null`, and `null` is a 400.
//
// The distinction that matters on the enroll route: a MALFORMED body is a 400,
// while every offer-related failure (wrong secret, expired, already consumed)
// is an identical `{ok:false}` at 200. Shape is not a secret; offer existence
// is, and answering it differently would make the route an oracle.
// ---------------------------------------------------------------------------

/** Longest device name the roster stores. Display text, so it is merely bounded. */
const MAX_DEVICE_NAME_CHARS = 64;

/** `enroll_id` is `sha256hex(secret)` — lowercase hex, nothing else. */
const ENROLL_ID_SHAPE = /^[0-9a-f]{64}$/;

export function parseEnrollOfferRequest(raw: unknown): EnrollOfferRequest | null {
  if (!isRecord(raw)) return null;
  const { enrollId, notAfter } = raw;
  if (typeof enrollId !== "string" || !ENROLL_ID_SHAPE.test(enrollId)) return null;
  if (!isPositiveInteger(notAfter)) return null;
  return { enrollId, notAfter };
}

export function parseEnrollRequest(raw: unknown): EnrollRequest | null {
  if (!isRecord(raw)) return null;
  const { s, publicKey, deviceName } = raw;
  if (typeof s !== "string" || s === "" || base64UrlDecode(s) === null) return null;
  if (typeof publicKey !== "string" || !isDevicePublicKey(publicKey)) return null;
  if (typeof deviceName !== "string") return null;
  const name = sanitizeDeviceName(deviceName);
  if (name === "") return null;
  return { s, publicKey, deviceName: name };
}

export function parseRevokeRequest(raw: unknown): RevokeRequest | null {
  if (!isRecord(raw)) return null;
  const { publicKey } = raw;
  if (typeof publicKey !== "string" || !isDevicePublicKey(publicKey)) return null;
  return { publicKey };
}

/** base64url of exactly one raw Ed25519 public key, in its one canonical spelling. */
function isDevicePublicKey(value: string): boolean {
  const bytes = base64UrlDecode(value);
  return bytes !== null && bytes.length === ED25519_PUBLIC_KEY_BYTES;
}

/** Read a request body as JSON, or `null` when it isn't any. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Collapse whitespace, drop control characters, bound the length. */
function sanitizeDeviceName(raw: string): string {
  let name = "";
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    name += code < 0x20 || code === 0x7f ? " " : char;
  }
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_DEVICE_NAME_CHARS);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
