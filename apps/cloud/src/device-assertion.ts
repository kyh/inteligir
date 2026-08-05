import {
  ED25519_PUBLIC_KEY_BYTES,
  HEADER_AUTHORIZATION,
  isValidVaultId,
  parseBearer,
  parseDeviceAssertion,
  vaultIdFromKeyDigest,
  type DeviceAssertion,
} from "@repo/notes/sync/wire";
import { sha256Bytes } from "./hash";

// ---------------------------------------------------------------------------
// Device assertions — the ONE module both the Worker and the Durable Object
// verify credentials with.
//
// A device proves itself by SIGNING rather than by presenting something a
// server minted: the bearer string is a self-issued, 5-minute assertion over
// `{v, vid, dev, iat, exp}` (see `@repo/notes/sync/wire`). Verification is
// split in two and the two halves are INDEPENDENT on purpose:
//
//   • The Worker (here, statelessly) checks shape, the Ed25519 signature
//     against the key carried inside the assertion, the time window, and that
//     `vid` is the vault the path names. A failure is a 401 and the Durable
//     Object is never instantiated — which is what stops an unauthenticated
//     caller spinning up DOs by naming arbitrary strings.
//   • The DO (the authority) re-runs exactly this, then answers the membership
//     question only it can: is this key on my roster?
//
// Both read the RAW `Authorization` header. The tempting optimization — the
// Worker stamps its conclusion into `x-device` and the DO trusts it — turns one
// forged request header into full vault access, so there is deliberately no
// trusted-header seam between them to forge.
//
// Only PUBLIC keys are ever imported, so workerd's inability to import a raw
// Ed25519 private key never applies.
// ---------------------------------------------------------------------------

/** How long an assertion may claim to live. Longer is refused, not truncated. */
export const MAX_ASSERTION_LIFETIME_SECONDS = 600;

/**
 * How far into the future an `iat` may sit before we call the device's clock
 * broken. This plus the lifetime cap is the whole clock-skew tolerance: a
 * device more than a minute fast, or more than its assertion's lifetime slow,
 * cannot authenticate at all.
 */
export const MAX_CLOCK_SKEW_SECONDS = 60;

/**
 * Why a credential was refused. It rides in the 401 BODY because the symptom of
 * a skewed clock is otherwise indistinguishable from "sync broke": there is no
 * sign-in to offer, so the client must be able to say "check this device's
 * clock" instead.
 */
export type AssertionRejection =
  | "missing-credential"
  | "invalid-vault-id"
  | "vault-mismatch"
  | "assertion-lifetime"
  | "assertion-not-yet-valid"
  | "assertion-expired"
  | "bad-signature";

/** A credential that survived every stateless check. Membership is a separate question. */
export type VerifiedDevice = {
  /** base64url of the raw public key — the roster's primary key. */
  readonly publicKey: string;
  readonly publicKeyBytes: Uint8Array;
  readonly vaultId: string;
};

export type AssertionVerdict =
  | { readonly ok: true; readonly device: VerifiedDevice }
  | { readonly ok: false; readonly reason: AssertionRejection };

/**
 * The device assertion this request carries, or `null` when it carries none.
 *
 * "None" includes a bearer that simply isn't one — a Better Auth session token,
 * say — which is how the two credential models coexist: a caller is on the
 * device path iff its bearer parses as an assertion.
 */
export function readDeviceAssertion(headers: Headers): DeviceAssertion | null {
  const token = parseBearer(headers.get(HEADER_AUTHORIZATION));
  return token === null ? null : parseDeviceAssertion(token);
}

/**
 * Verify an assertion `readDeviceAssertion` produced against `vaultId`.
 * Stateless: it answers "this key signed this, recently, for this vault" and
 * nothing about whether the key is enrolled.
 */
export async function verifyDeviceAssertion(
  assertion: DeviceAssertion,
  vaultId: string,
  nowSeconds: number,
): Promise<AssertionVerdict> {
  if (!isValidVaultId(vaultId)) return { ok: false, reason: "invalid-vault-id" };
  const { payload } = assertion;
  if (payload.vid !== vaultId) return { ok: false, reason: "vault-mismatch" };

  // Signature BEFORE the clock, so a reported `assertion-expired` is a claim
  // the key actually made rather than one an attacker typed.
  if (!(await verifySignature(assertion))) return { ok: false, reason: "bad-signature" };

  if (payload.exp - payload.iat > MAX_ASSERTION_LIFETIME_SECONDS) {
    return { ok: false, reason: "assertion-lifetime" };
  }
  if (payload.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "assertion-not-yet-valid" };
  }
  if (payload.exp <= nowSeconds) return { ok: false, reason: "assertion-expired" };

  return {
    ok: true,
    device: {
      publicKey: payload.dev,
      publicKeyBytes: assertion.devicePublicKey,
      vaultId,
    },
  };
}

/**
 * Does this key found `vaultId`? The founding check is arithmetic, not
 * trust-on-first-use: there is no window in which whoever arrives first wins.
 */
export async function keyFoundsVault(
  publicKeyBytes: Uint8Array,
  vaultId: string,
): Promise<boolean> {
  if (publicKeyBytes.length !== ED25519_PUBLIC_KEY_BYTES) return false;
  const derived = vaultIdFromKeyDigest(await sha256Bytes(publicKeyBytes));
  return derived !== null && derived === vaultId;
}

/** The 401 a refused credential produces, with the reason as its whole body. */
export function unauthorized(reason: AssertionRejection): Response {
  return new Response(reason, {
    status: 401,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function verifySignature(assertion: DeviceAssertion): Promise<boolean> {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      assertion.devicePublicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    // A 32-byte string that isn't a valid curve point — shape passed, key didn't.
    return false;
  }
  return crypto.subtle.verify({ name: "Ed25519" }, key, assertion.signature, assertion.signedBytes);
}
