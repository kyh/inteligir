import { z } from "zod";

// pattern after bb's connect code (github.com/get-bb/bb, MIT)

export const DEVICE_API_PATHS = {
  mintCode: "/v1/device/code",
  redeem: "/v1/device/redeem",
  list: "/v1/device/list",
  revoke: "/v1/device/revoke",
} as const;

export const PAIRING_CODE_TTL_MS = 10 * 60_000;

export const DEVICE_PAIR_PURPOSE = "device-pair";

// no 0/O/1/I; 32^8 ≈ 2^40, guessable only past the mint TTL and the redeem rate window together
export const PAIRING_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

// the prefix routes a bearer to the device table without asking better auth, so a session
// token and a device credential cannot shadow each other
export const DEVICE_CREDENTIAL_PREFIX = "igd_";
export const DEVICE_CREDENTIAL_PATTERN = /^igd_[0-9a-f]{64}$/;

// pkce (rfc 7636, S256): `state` guards only this app's callback and redeem is
// unauthenticated, so without it any loopback listener receiving the redirect could spend
// the code; the verifier never leaves the app and only its challenge rides the browser.

// 32 bytes → 43 base64url chars, inside rfc 7636's 43–128 range; a sha-256 challenge is the same width
export const PKCE_VERIFIER_BYTES = 32;

export const PKCE_S256_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// btoa is a global on workerd, node, the browser and hermes (rn 0.74+); Buffer is not
function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// injectable because hermes carries neither crypto.getRandomValues nor crypto.subtle
// reliably; the phone injects expo-crypto
export interface PkceCrypto {
  randomBytes(length: number): Uint8Array;
  sha256(input: string): Promise<Uint8Array>;
}

export const webPkceCrypto: PkceCrypto = {
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  sha256: async (input) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))),
};

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function generatePkceVerifier(
  crypto: Pick<PkceCrypto, "randomBytes"> = webPkceCrypto,
): string {
  return base64UrlFromBytes(crypto.randomBytes(PKCE_VERIFIER_BYTES));
}

export async function pkceChallengeS256(
  verifier: string,
  crypto: Pick<PkceCrypto, "sha256"> = webPkceCrypto,
): Promise<string> {
  return base64UrlFromBytes(await crypto.sha256(verifier));
}

export async function createPkcePair(crypto: PkceCrypto = webPkceCrypto): Promise<PkcePair> {
  const verifier = generatePkceVerifier(crypto);
  return { verifier, challenge: await pkceChallengeS256(verifier, crypto) };
}

export const mintPairingCodeResponseSchema = z
  .object({
    code: z.string().regex(PAIRING_CODE_PATTERN),
    expiresInMs: z.number().int().positive(),
  })
  .strict();
export type MintPairingCodeResponse = z.infer<typeof mintPairingCodeResponseSchema>;

// S256 only: a plaintext-equal challenge binds nothing an interceptor could not also send
export const mintPairingCodeRequestSchema = z
  .object({
    challenge: z.string().regex(PKCE_S256_PATTERN),
    challengeMethod: z.literal("S256"),
  })
  .strict();
export type MintPairingCodeRequest = z.infer<typeof mintPairingCodeRequestSchema>;

// exported: the local app's front route bounds the same two fields, and a hand-copied
// number passes locally but is refused here as a shape error
export const PAIRING_CODE_MAX_LENGTH = 16;
export const DEVICE_NAME_MAX_LENGTH = 64;

export const redeemDeviceRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(PAIRING_CODE_MAX_LENGTH),
    deviceName: z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH),
    verifier: z.string().regex(PKCE_S256_PATTERN),
  })
  .strict();
export type RedeemDeviceRequest = z.infer<typeof redeemDeviceRequestSchema>;

// the credential at rest is parsed on every read: a malformed record must read as
// "not paired", never as a credential the cloud refuses on every request forever
const deviceCredentialFields = {
  deviceId: z.string().min(1),
  credential: z.string().regex(DEVICE_CREDENTIAL_PATTERN),
};
export const deviceCredentialSchema = z.object(deviceCredentialFields).strict();
export type DeviceCredential = z.infer<typeof deviceCredentialSchema>;

export const redeemDeviceResponseSchema = z.object(deviceCredentialFields).strict();
export type RedeemDeviceResponse = z.infer<typeof redeemDeviceResponseSchema>;

export const deviceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    createdAt: z.number().int(),
    lastSeenAt: z.number().int().nullable(),
    revokedAt: z.number().int().nullable(),
  })
  .strict();
export type Device = z.infer<typeof deviceSchema>;

export const listDevicesResponseSchema = z
  .object({
    devices: z.array(deviceSchema),
  })
  .strict();
export type ListDevicesResponse = z.infer<typeof listDevicesResponseSchema>;

export const revokeDeviceRequestSchema = z
  .object({
    deviceId: z.string().min(1),
  })
  .strict();
export type RevokeDeviceRequest = z.infer<typeof revokeDeviceRequestSchema>;

export const revokeDeviceResponseSchema = z
  .object({
    revoked: z.literal(true),
  })
  .strict();
export type RevokeDeviceResponse = z.infer<typeof revokeDeviceResponseSchema>;

export const PAIR_CALLBACK_PATH = "/pair/callback";

export const PAIR_CALLBACK_PARAMS = {
  code: "code",
  state: "state",
} as const;

export const PAIR_APPROVE_PATH = "/app/pair";
export const PAIR_APPROVE_PARAMS = {
  redirect: "redirect",
  state: "state",
  name: "name",
  challenge: "challenge",
} as const;

// the app binds this literal only: [::1] is an address nothing listens on and localhost is
// a name a hostile resolver answers for, and this redirect carries a live pairing code
export const PAIR_CALLBACK_HOST = "127.0.0.1";

// the phone's deep link. URL.origin answers "null" for a non-special scheme, so this arm is
// judged on fields like the loopback one. an app squatting the scheme on the same os still
// receives the redirect, code included; pkce is what keeps that code unspendable.
export const PAIR_MOBILE_REDIRECT_SCHEME = "inteligir:";

export const PAIR_MOBILE_REDIRECT_SEGMENT = PAIR_CALLBACK_PATH.slice(1);

// parsed by the same parser that judges a candidate, so the two cannot disagree
const PAIR_MOBILE_REDIRECT = new URL(
  `${PAIR_MOBILE_REDIRECT_SCHEME}//${PAIR_MOBILE_REDIRECT_SEGMENT}`,
);

export const PAIR_STATE_BYTES = 16;
export const PAIR_STATE_PATTERN = /^[0-9a-f]{32}$/;

export type PairRedirectKind = "loopback" | "mobile";

type PairRedirectJudgement = { ok: true; kind: PairRedirectKind } | { ok: false; problem: string };

// judged on URL fields, never as text: `new URL("http://127.0.0.1@evil.com/")` has username
// 127.0.0.1 and hostname evil.com, so a string match reads the wrong field
function judgePairRedirect(value: string): PairRedirectJudgement {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, problem: "is not an absolute URL" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, problem: "must carry no userinfo" };
  }
  if (url.search !== "" || url.hash !== "") {
    return {
      ok: false,
      problem: "must carry no query or fragment — the code and state are appended to it",
    };
  }
  if (url.protocol === "http:") {
    // loopback carries no TLS, so an https target is somewhere else
    if (url.hostname !== PAIR_CALLBACK_HOST) {
      return { ok: false, problem: `must be ${PAIR_CALLBACK_HOST} (got "${url.hostname}")` };
    }
    // port unconstrained: loopback is loopback on any port, and URL drops `:80` for http,
    // so an explicit-port rule refused an app bound to 80
    if (url.pathname !== PAIR_CALLBACK_PATH) {
      return { ok: false, problem: `must be ${PAIR_CALLBACK_PATH} (got "${url.pathname}")` };
    }
    return { ok: true, kind: "loopback" };
  }
  if (url.protocol === PAIR_MOBILE_REDIRECT_SCHEME) {
    // non-special schemes never case-fold the host, so this is exact against `PAIR` too
    if (url.hostname !== PAIR_MOBILE_REDIRECT.hostname) {
      return {
        ok: false,
        problem: `must be ${PAIR_MOBILE_REDIRECT_SCHEME}//${PAIR_MOBILE_REDIRECT.hostname} (got host "${url.hostname}")`,
      };
    }
    if (url.port !== "") {
      return { ok: false, problem: "must name no port — a custom scheme has no server" };
    }
    if (url.pathname !== PAIR_MOBILE_REDIRECT.pathname) {
      return {
        ok: false,
        problem: `must be ${PAIR_MOBILE_REDIRECT.pathname} (got "${url.pathname}")`,
      };
    }
    return { ok: true, kind: "mobile" };
  }
  return {
    ok: false,
    problem: `must be http: (the loopback callback) or ${PAIR_MOBILE_REDIRECT_SCHEME} (the mobile deep link) — got "${url.protocol}"`,
  };
}

export function pairRedirectKind(value: string): PairRedirectKind | null {
  const judged = judgePairRedirect(value);
  return judged.ok ? judged.kind : null;
}

export const pairRedirectUrlSchema = z.string().superRefine((value, ctx) => {
  const judged = judgePairRedirect(value);
  if (!judged.ok) {
    ctx.addIssue({ code: "custom", message: `a pairing callback ${judged.problem}` });
  }
});

// not .strict(): a stray parameter picked up through sign-in is no reason to refuse a pairing
export const pairApproveSearchSchema = z.object({
  [PAIR_APPROVE_PARAMS.redirect]: pairRedirectUrlSchema,
  [PAIR_APPROVE_PARAMS.state]: z.string().regex(PAIR_STATE_PATTERN),
  [PAIR_APPROVE_PARAMS.name]: z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH),
  [PAIR_APPROVE_PARAMS.challenge]: z.string().regex(PKCE_S256_PATTERN),
});
export type PairApproveSearch = z.infer<typeof pairApproveSearchSchema>;

export function buildPairApproveUrl(cloudUrl: string, search: PairApproveSearch): string {
  const url = new URL(PAIR_APPROVE_PATH, cloudUrl);
  url.searchParams.set(PAIR_APPROVE_PARAMS.redirect, search.redirect);
  url.searchParams.set(PAIR_APPROVE_PARAMS.state, search.state);
  url.searchParams.set(PAIR_APPROVE_PARAMS.name, search.name);
  url.searchParams.set(PAIR_APPROVE_PARAMS.challenge, search.challenge);
  return url.toString();
}

// `redirect` has already been through pairRedirectUrlSchema; that is what makes appending safe
export function buildPairCallbackUrl(
  redirect: string,
  args: { code: string; state: string },
): string {
  const url = new URL(redirect);
  url.searchParams.set(PAIR_CALLBACK_PARAMS.code, args.code);
  url.searchParams.set(PAIR_CALLBACK_PARAMS.state, args.state);
  return url.toString();
}
