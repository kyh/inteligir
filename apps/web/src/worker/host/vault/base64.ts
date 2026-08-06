// ---------------------------------------------------------------------------
// Standard base64 ↔ bytes, for the two Bridge channels that carry attachment
// bytes as strings (`writeVaultAsset`, `readVaultAsset`).
//
// Standard base64, NOT base64URL: the two alphabets differ on `+` and `/`, and
// feeding a standard payload through a URL-alphabet decoder corrupts both.
// ---------------------------------------------------------------------------

/** `btoa`/`atob` work over a latin1 STRING, so bytes cross in chunks small
 * enough that `String.fromCharCode(...)` never overflows the argument stack. */
const CHUNK = 8192;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/** Decode standard base64, or `null` when the input is not valid base64 — a
 * wire value, so a malformed payload is refused rather than thrown past. */
export function base64ToBytes(text: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
