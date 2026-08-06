// ---------------------------------------------------------------------------
// Server-side content hashing. The coordinator hashes bytes itself (Web Crypto)
// so `contentHash` is AUTHORITATIVE — a client can never lie about what it
// stored. Matches @repo/notes's `Hash`: a lowercase sha-256 hex digest (64 chars).
// ---------------------------------------------------------------------------

/** Raw sha-256 digest of `bytes` — what the self-certifying vaultId is derived from. */
export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** Lowercase sha-256 hex digest of `bytes` (matches `@repo/notes` `Hash`). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  let hex = "";
  for (const byte of await sha256Bytes(bytes)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
