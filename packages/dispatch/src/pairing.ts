// ---------------------------------------------------------------------------
// Pairing credentials.
//
// A pairing credential is roomId + pairingToken, generated on the desktop and
// shown to the user as ONE copyable/typeable string:
//
//     XXXX-XXXX-XXXX-XXXX.tttttttttttttttttttttt
//     └── roomId (80 bits) ┘└─ token (128 bits) ─┘
//
//  - roomId: 16 chars from a 32-char alphabet (no I/O/0/1 — typo-resistant),
//    80 bits of CSPRNG entropy. Doubles as the relay room name.
//  - token: 16 CSPRNG bytes, base64url (22 chars). The bearer secret. The
//    Worker stores only its SHA-256 hash (see `hashToken`); clients send the
//    raw token over TLS at connect time.
//
// Runtime requirements are isolated per function: `generatePairingCredential`
// needs crypto.getRandomValues (desktop only), `hashToken` needs WebCrypto
// subtle (Worker, optionally desktop). Mobile only calls
// `parsePairingString`, which is pure — React Native never touches WebCrypto.
// ---------------------------------------------------------------------------

/** Minimal WebCrypto surface this module relies on. Declared locally (not via
 * lib DOM / @types/node) so the file typechecks under every consumer's
 * tsconfig; resolves to the global `crypto` at runtime. */
type CryptoLike = {
  getRandomValues(array: Uint8Array): Uint8Array;
  subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
};
declare const crypto: CryptoLike;

/** 32 chars (5 bits each). Excludes I, O, 0, 1 — unambiguous to read/type. */
export const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** 16 chars × 5 bits = 80 bits of room-name entropy. */
export const ROOM_ID_LENGTH = 16;
/** 16 bytes = 128 bits of bearer-token entropy. */
export const PAIRING_TOKEN_BYTES = 16;

const ROOM_ID_GROUP_SIZE = 4;
const ROOM_ID_PATTERN = new RegExp(`^[${ROOM_ID_ALPHABET}]{${ROOM_ID_LENGTH}}$`);
/** 22 chars is exactly 16 bytes base64url; allow longer for future rotation. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

export type PairingCredential = {
  /** Canonical form: uppercase, no separators. Used as the relay room name. */
  roomId: string;
  /** Raw bearer token, base64url. Never stored server-side in plaintext. */
  token: string;
};

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    out += BASE64URL_ALPHABET.charAt(b0 >> 2);
    out += BASE64URL_ALPHABET.charAt(((b0 & 0b11) << 4) | (b1 >> 4));
    if (i + 1 < bytes.length) {
      out += BASE64URL_ALPHABET.charAt(((b1 & 0b1111) << 2) | (b2 >> 6));
    }
    if (i + 2 < bytes.length) {
      out += BASE64URL_ALPHABET.charAt(b2 & 0b111111);
    }
  }
  return out;
}

/** Generate a fresh credential with the platform CSPRNG. Desktop-only (the
 * desktop mints credentials; mobile and the Worker only consume them). */
export function generatePairingCredential(): PairingCredential {
  const roomBytes = crypto.getRandomValues(new Uint8Array(ROOM_ID_LENGTH));
  let roomId = "";
  for (const byte of roomBytes) {
    // 256 / 32 divides evenly — no modulo bias.
    roomId += ROOM_ID_ALPHABET.charAt(byte % ROOM_ID_ALPHABET.length);
  }
  const tokenBytes = crypto.getRandomValues(new Uint8Array(PAIRING_TOKEN_BYTES));
  return { roomId, token: base64UrlEncode(tokenBytes) };
}

/** Render a credential as the single user-facing pairing string:
 * dash-grouped roomId, a `.` separator, then the token verbatim. */
export function formatPairingString(credential: PairingCredential): string {
  const groups: string[] = [];
  for (let i = 0; i < credential.roomId.length; i += ROOM_ID_GROUP_SIZE) {
    groups.push(credential.roomId.slice(i, i + ROOM_ID_GROUP_SIZE));
  }
  return `${groups.join("-")}.${credential.token}`;
}

/** Parse a user-entered pairing string back into a credential. Tolerant of
 * whitespace, missing/extra dashes, and lowercase in the roomId part; the
 * token part is case-sensitive. Returns null on anything invalid. */
export function parsePairingString(input: string): PairingCredential | null {
  const trimmed = input.trim();
  const dot = trimmed.indexOf(".");
  if (dot === -1) return null;
  const roomId = trimmed.slice(0, dot).replace(/[\s-]/g, "").toUpperCase();
  const token = trimmed.slice(dot + 1).trim();
  if (!ROOM_ID_PATTERN.test(roomId)) return null;
  if (!TOKEN_PATTERN.test(token)) return null;
  return { roomId, token };
}

/** Whether a string is a canonical roomId (the relay validates room names
 * with this before instantiating a Durable Object). */
export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_PATTERN.test(roomId);
}

const UTF8_ONE_BYTE_MAX = 0x7f;

function utf8Encode(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of value) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp <= UTF8_ONE_BYTE_MAX) {
      bytes.push(cp);
    } else if (cp <= 0x7ff) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

/** SHA-256 of the raw token, lowercase hex. The Worker stores this (never the
 * plaintext token) when the desktop claims a room, and compares it against
 * the hash of each connecting peer's presented token. Requires WebCrypto
 * subtle — available in Workers and Node ≥ 20; mobile never calls this. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8Encode(token));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
