// ---------------------------------------------------------------------------
// This device's Ed25519 sync key: generate one, and mint the short-lived
// assertion the coordinator accepts as a bearer credential
// (apps/web/README.md § Device keys).
//
// PURE — no expo, no react-native — so the whole crypto path runs under node in
// tests. @noble/ed25519 + @noble/hashes are pure JS, so there is no native
// module to build and nothing differs between Hermes and the test runner.
//
// `hashes.sha512` is wired here because it is what makes the SYNCHRONOUS API
// available at all — the async one reaches for WebCrypto's `subtle`, which
// Hermes does not have.
//
// THE RANDOMNESS IS NAMED, NOT INHERITED. React Native's ambient
// `crypto.getRandomValues` is not a secure generator, and a weak device key is
// both invisible and unrecoverable, so the CSPRNG is injected
// (`installRandomSource`; expo-crypto binds it in ./device.ts) and key
// generation fails closed until it is. noble's own `etc.randomBytes` is not
// the seam for this — v3 freezes `etc`, and its generator is reachable only by
// calling `keygen()`/`randomSecretKey()` with NO seed. Nothing here ever does:
// the seed is always drawn from the installed source and passed in explicitly.
//
// Mobile only ever ENROLLS: nothing here derives a vaultId from this key. The
// vault is the desktop's folder on disk, and a phone-founded vault is a second
// vaultId that never converges with it.
// ---------------------------------------------------------------------------

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  base64UrlDecode,
  base64UrlEncode,
  DEVICE_ASSERTION_VERSION,
  deviceAssertionSignedBytes,
  encodeDeviceAssertionPayload,
  formatDeviceAssertion,
} from "@repo/notes/sync/wire";

ed.hashes.sha512 = sha512;

/** Raw Ed25519 secret-key seed length — what `keygen` takes and stores back. */
const ED25519_SECRET_KEY_BYTES = 32;

/**
 * How long a minted assertion claims to live. The coordinator refuses anything
 * over 600s and tolerates 60s of forward skew, so this sits comfortably inside
 * both: short enough that a captured header dies quickly, long enough that a
 * mildly wrong clock still authenticates.
 */
const ASSERTION_LIFETIME_SECONDS = 300;

/** The two halves of a device key, base64url so storage stays string-shaped. */
export type DeviceKeyPair = {
  /** The raw 32-byte secret key. Secret — the keychain is its only home. */
  readonly secretKey: string;
  /** The raw 32-byte public key — this device's row on the vault roster. */
  readonly publicKey: string;
};

/** A cryptographically secure random-byte source. */
export type RandomBytes = (length: number) => Uint8Array;

let randomSource: RandomBytes | null = null;

/** Name the CSPRNG this device's key is drawn from. Called once at composition
 * (./device.ts binds expo-crypto). */
export function installRandomSource(random: RandomBytes): void {
  randomSource = random;
}

/** Generate this device's key. Throws until a CSPRNG is installed — a device
 * key from an unnamed source is exactly the failure that must never be silent. */
export function generateDeviceKey(): DeviceKeyPair {
  if (randomSource === null) {
    throw new Error("sync: no secure random source installed for the device key");
  }
  const pair = ed.keygen(randomSource(ED25519_SECRET_KEY_BYTES));
  return {
    secretKey: base64UrlEncode(pair.secretKey),
    publicKey: base64UrlEncode(pair.publicKey),
  };
}

/**
 * Mint the bearer credential for ONE request: a self-issued assertion over
 * `{v, vid, dev, iat, exp}`, signed with this device's key. Minted per request
 * rather than cached — it expires in minutes, and signing is cheaper than
 * reasoning about when a cached one went stale.
 */
export function mintDeviceAssertion(key: DeviceKeyPair, vaultId: string, nowMs: number): string {
  const secretKey = base64UrlDecode(key.secretKey);
  if (secretKey === null || secretKey.length !== ED25519_SECRET_KEY_BYTES) {
    throw new Error("sync: this device's sync key is unreadable");
  }
  const iat = Math.floor(nowMs / 1000);
  const encoded = encodeDeviceAssertionPayload({
    v: DEVICE_ASSERTION_VERSION,
    vid: vaultId,
    dev: key.publicKey,
    iat,
    exp: iat + ASSERTION_LIFETIME_SECONDS,
  });
  if (encoded === null) throw new Error("sync: could not encode a device assertion");
  return formatDeviceAssertion(encoded, ed.sign(deviceAssertionSignedBytes(encoded), secretKey));
}
