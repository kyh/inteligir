// ---------------------------------------------------------------------------
// Server-side content hashing. The coordinator hashes bytes itself (Web Crypto)
// so `contentHash` is AUTHORITATIVE — a client can never lie about what it
// stored. Matches @repo/core's `Hash`: a lowercase sha-256 hex digest (64 chars).
// ---------------------------------------------------------------------------

/** Lowercase sha-256 hex digest of `bytes` (matches `@repo/core` `Hash`). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
