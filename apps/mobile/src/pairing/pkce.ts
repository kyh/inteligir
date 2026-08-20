// PKCE (RFC 7636, S256) on the phone — the secret VERIFIER never leaves the app,
// only its S256 CHALLENGE rides the browser (see the contract's pairing header).
//
// WHY THIS IS NOT the contract's own `generatePkceVerifier` / `pkceChallengeS256`:
// those run on `crypto.getRandomValues` + `crypto.subtle`, which the contract
// states are for workerd, Node and the browser. React Native's Hermes carries
// neither reliably, so the primitives are INJECTED (expo-crypto in production,
// Node crypto in the suite) and this module owns only the assembly — the same
// base64url encoding, the same `verifier → S256(verifier)` shape. The suite PINS
// the result against the contract's own transform, so the two spellings cannot
// drift.

import { PKCE_VERIFIER_BYTES } from "@repo/cloud-contract/pairing";

/** The two crypto primitives a PKCE pair needs, and a hex source for the pairing
 *  `state`. Injected so the assembly is exercised without a native module. */
export interface PkceCrypto {
  /** Cryptographically-random bytes. */
  randomBytes(length: number): Uint8Array;
  /** `SHA-256(utf8(input))` as raw bytes. */
  sha256(input: string): Promise<Uint8Array>;
}

export interface PkcePair {
  /** The secret kept in the pending slot, presented at redeem. */
  verifier: string;
  /** `BASE64URL(SHA-256(ASCII(verifier)))` — what the browser carries to the mint. */
  challenge: string;
}

/** Byte array → base64url with no padding — the exact encoding the contract's
 *  `PKCE_S256_PATTERN` (43 chars) admits. `btoa` is a global on Hermes (RN 0.74+)
 *  and on Node, so this one spelling runs in both the app and the suite. */
export function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Byte array → lowercase hex — the pairing `state`'s shape (`PAIR_STATE_PATTERN`). */
export function hexFromBytes(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** A fresh verifier + its S256 challenge. */
export async function createPkcePair(crypto: PkceCrypto): Promise<PkcePair> {
  const verifier = base64UrlFromBytes(crypto.randomBytes(PKCE_VERIFIER_BYTES));
  const challenge = base64UrlFromBytes(await crypto.sha256(verifier));
  return { verifier, challenge };
}
