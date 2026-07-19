// ---------------------------------------------------------------------------
// The Expo Crypto backing for the engine's async `Hasher`. Content-addresses a
// file's bytes as a lowercase sha-256 hex digest. This MUST match the hash the
// coordinator computes for the same bytes (and @repo/domain's Web-Crypto test
// hasher), so equal bytes hash equal — `reconcile` relies on it.
// ---------------------------------------------------------------------------

import * as Crypto from "expo-crypto";

import type { Hasher } from "@repo/domain/sync/engine";

/** A sha-256 hex `Hasher` backed by expo-crypto. */
export function createExpoHasher(): Hasher {
  return async (bytes) => {
    // Copy into a fresh (non-shared) buffer so the type is `<ArrayBuffer>`, which
    // `BufferSource` requires — a plain Uint8Array may be SharedArrayBuffer-backed.
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
}
