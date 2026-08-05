import {
  base64UrlEncode,
  deviceAssertionSignedBytes,
  encodeDeviceAssertionPayload,
  formatBearer,
  formatDeviceAssertion,
  vaultIdFromKeyDigest,
} from "@repo/notes/sync/wire";
import { sha256Bytes, sha256Hex } from "../src/hash";

// ---------------------------------------------------------------------------
// Test-side device: an Ed25519 keypair that mints REAL assertions in the same
// wire format the desktop and mobile clients will. Nothing here is a stub — the
// suite drives the actual credential the Worker and DO verify.
// ---------------------------------------------------------------------------

/** Assertion lifetime the real clients mint at. */
export const ASSERTION_LIFETIME_SECONDS = 300;

export type TestDevice = {
  /** base64url of the raw public key — the roster's primary key. */
  readonly publicKey: string;
  /** The vaultId this key founds: `v1` + base32(sha256(publicKey)). */
  readonly vaultId: string;
  /** Mint a bearer assertion. Every timing knob is overridable so skew is testable. */
  assert(vaultId: string, options?: AssertionOptions): Promise<string>;
  /** `{ authorization: "Bearer <assertion>" }` for the given vault. */
  auth(vaultId: string, options?: AssertionOptions): Promise<Record<string, string>>;
  /** Sign someone else's encoded payload — the primitive a forgery test needs. */
  signOver(encodedPayload: string): Promise<string>;
};

export type AssertionOptions = {
  readonly iat?: number;
  readonly lifetimeSeconds?: number;
  /** Sign with a DIFFERENT key than the payload names — forgery. */
  readonly signWith?: TestDevice;
};

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function createDevice(): Promise<TestDevice> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  if (!("privateKey" in pair)) throw new Error("expected an Ed25519 key pair");
  const exported = await crypto.subtle.exportKey("raw", pair.publicKey);
  if (!(exported instanceof ArrayBuffer)) throw new Error("expected raw public key bytes");
  const raw = new Uint8Array(exported);
  const publicKey = base64UrlEncode(raw);
  const vaultId = vaultIdFromKeyDigest(await sha256Bytes(raw));
  if (vaultId === null) throw new Error("public key did not derive a vaultId");

  const sign = async (bytes: Uint8Array): Promise<Uint8Array> =>
    new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, bytes));

  const device: TestDevice = {
    publicKey,
    vaultId,
    async assert(targetVaultId, options = {}) {
      const iat = options.iat ?? nowSeconds();
      const encoded = encodeDeviceAssertionPayload({
        v: 1,
        vid: targetVaultId,
        dev: publicKey,
        iat,
        exp: iat + (options.lifetimeSeconds ?? ASSERTION_LIFETIME_SECONDS),
      });
      if (encoded === null) throw new Error("payload rejected by its own encoder");
      const signer = options.signWith;
      if (signer !== undefined) {
        // Re-sign with the forger's key while the payload still names ours.
        return signer.signOver(encoded);
      }
      return formatDeviceAssertion(encoded, await sign(deviceAssertionSignedBytes(encoded)));
    },
    async auth(targetVaultId, options) {
      return { authorization: formatBearer(await device.assert(targetVaultId, options)) };
    },
    signOver: async (encodedPayload: string) =>
      formatDeviceAssertion(encodedPayload, await sign(deviceAssertionSignedBytes(encodedPayload))),
  };
  return device;
}

/** A pairing offer: the secret the joining device presents, and its server-side id. */
export type EnrollOffer = { readonly s: string; readonly enrollId: string };

/** Mint an offer exactly as the desktop will: 32 CSPRNG bytes, server sees only the hash. */
export async function createEnrollOffer(): Promise<EnrollOffer> {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return { s: base64UrlEncode(secret), enrollId: await sha256Hex(secret) };
}
