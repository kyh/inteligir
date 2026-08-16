// ---------------------------------------------------------------------------
// Server-side content hashing. The host hashes bytes itself (Web Crypto) so
// `contentHash` is AUTHORITATIVE — a client can never lie about what it stored.
// A lowercase sha-256 hex digest (64 chars).
// ---------------------------------------------------------------------------

/** Lowercase sha-256 hex digest of `bytes`. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
