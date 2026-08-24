import { z } from "zod";

// ---------------------------------------------------------------------------
// Device pairing (bb's connect-code pattern, MIT — github.com/get-bb/bb).
//
// The flow: a signed-in dashboard mints a short one-time CODE; the local app
// redeems it once for a durable device CREDENTIAL. The code is human-typable
// and short-lived; the credential is 256-bit, stored server-side only as a
// SHA-256 hash, and presented as `Authorization: Bearer` on every sync call.
// ---------------------------------------------------------------------------

/**
 * Where the pairing surface is served. Beside the schemas rather than in each
 * implementation, because a path IS wire: the Worker routes on it, the
 * dashboard fetches it and the local app dials it, and three private copies of
 * a string are three places a rename can miss.
 */
export const DEVICE_API_PATHS = {
  mintCode: "/v1/device/code",
  redeem: "/v1/device/redeem",
  list: "/v1/device/list",
  revoke: "/v1/device/revoke",
} as const;

export const PAIRING_CODE_TTL_MS = 10 * 60_000;

/** The one purpose today's codes carry; a future flow adds its own value
 * rather than overloading this one. */
export const DEVICE_PAIR_PURPOSE = "device-pair";

/** `XXXX-XXXX` over an alphabet with no 0/O/1/I — 32^8 ≈ 2^40, guessable only
 * past the mint's TTL and the redeem route's rate window together. */
export const PAIRING_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** What a device credential looks like on the wire. The prefix is load-bearing:
 * it lets the Worker route a bearer to the device table without ever asking
 * Better Auth, so a session token and a device credential cannot shadow each
 * other. */
export const DEVICE_CREDENTIAL_PREFIX = "igd_";
export const DEVICE_CREDENTIAL_PATTERN = /^igd_[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// PKCE (RFC 7636, S256) — what BINDS the one-time code to the app that began
// the pairing, so intercepting the code stops being enough to redeem it.
//
// The redirect's `state` guards THIS APP's callback and never reaches the
// cloud; `redeem` is unauthenticated, so without PKCE any loopback listener
// that receives the redirect could read the code off the query and redeem it
// directly. So the app keeps a secret VERIFIER, ships only its
// `SHA-256`→base64url CHALLENGE through the browser (to the mint, stored on the
// code row), and presents the verifier at redeem. The cloud rejects unless
// `S256(verifier)` equals the stored challenge — and the verifier never leaves
// the app, so an intercepted code alone cannot be spent.
//
// One spelling of the transform, here, because both ends compute it: the app at
// begin, the cloud at redeem. Web crypto globals only (`crypto`,
// `TextEncoder`, `btoa`) — this leaf runs on workerd, Node and the browser, and
// all three carry them.

/** 32 random bytes as base64url — 43 chars, inside RFC 7636's 43–128 range. */
export const PKCE_VERIFIER_BYTES = 32;

/** base64url with no padding: the shape of both a verifier and an S256
 *  challenge (SHA-256 is 32 bytes → 43 base64url chars). */
export const PKCE_S256_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** A fresh code verifier — the secret that never leaves the app. */
export function generatePkceVerifier(): string {
  const bytes = new Uint8Array(PKCE_VERIFIER_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlFromBytes(bytes);
}

/** `BASE64URL(SHA-256(ASCII(verifier)))` — the S256 challenge, computed the
 *  same way on both ends so a compare is meaningful. */
export async function pkceChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlFromBytes(new Uint8Array(digest));
}

export const mintPairingCodeResponseSchema = z
  .object({
    code: z.string().regex(PAIRING_CODE_PATTERN),
    expiresInMs: z.number().int().positive(),
  })
  .strict();
export type MintPairingCodeResponse = z.infer<typeof mintPairingCodeResponseSchema>;

// POST /v1/device/code (session-authed). The approve page mints WITH the
// challenge the app put on the redirect, and the cloud stores it on the code
// row. `S256` is the only method: a plain (or absent) challenge is refused at
// parse, because a code bound to a plaintext-equal challenge is a code bound to
// nothing an interceptor could not also send.
export const mintPairingCodeRequestSchema = z
  .object({
    challenge: z.string().regex(PKCE_S256_PATTERN),
    challengeMethod: z.literal("S256"),
  })
  .strict();
export type MintPairingCodeRequest = z.infer<typeof mintPairingCodeRequestSchema>;

/**
 * The ceilings a redeem is judged against. Exported because the LOCAL app puts
 * a route in front of this one and has to bound the same two fields — and a
 * hand-copied number there means a value that passes locally and is refused
 * here, reported to the user as a shape error about a code they typed
 * correctly.
 */
export const PAIRING_CODE_MAX_LENGTH = 16;
export const DEVICE_NAME_MAX_LENGTH = 64;

// POST /v1/device/redeem (the code IS the credential; consumed exactly once).
export const redeemDeviceRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(PAIRING_CODE_MAX_LENGTH),
    deviceName: z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH),
    /** The PKCE code verifier. Required: the cloud checks `S256(verifier)`
     *  against the challenge stored at mint, so a redeem without the secret the
     *  app kept cannot succeed even with the right code. */
    verifier: z.string().regex(PKCE_S256_PATTERN),
  })
  .strict();
export type RedeemDeviceRequest = z.infer<typeof redeemDeviceRequestSchema>;

/** The credential appears here ONCE, in plaintext; the server keeps only its
 * hash. Losing it means revoking the device and pairing again. */
export const redeemDeviceResponseSchema = z
  .object({
    deviceId: z.string().min(1),
    credential: z.string().regex(DEVICE_CREDENTIAL_PATTERN),
  })
  .strict();
export type RedeemDeviceResponse = z.infer<typeof redeemDeviceResponseSchema>;

// GET /v1/device/list (session-authed). Revoked devices stay listed — the
// dashboard is the audit surface, and a row vanishing on revoke would erase
// the evidence the revoke button exists to act on.
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

// POST /v1/device/revoke (session-authed). Revocation bites on the next
// request: the credential check is a per-request hash compare, never cached.
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

// ---------------------------------------------------------------------------
// Browser-approve pairing (issue #573).
//
// Nobody types the code any more; the browser carries it. The local app IS a
// loopback HTTP server, so the dance a CLI tool stands a callback server up for
// collapses to one more route on it: the app mints a `state` and opens the
// approve page, the page mints a code with the SESSION it already holds, and a
// top-level redirect hands code and state back to the loopback.
//
// The code machinery above is untouched, and it is still the whole security
// story — single-use, ten minutes, redeemed exactly once for a credential that
// never transits the browser. What changed is only who ferries it.
//
// Every spelling of that round trip lives HERE, on both ends: the two paths,
// the param names, and the schema that decides which redirect targets are
// admissible. A page holding its own copy of the callback path keeps sending
// browsers to the old one; a page holding its own host check is an open
// redirect handing live pairing codes to whoever asked for them.
// ---------------------------------------------------------------------------

/** Where the LOCAL app answers the approved redirect. A plain route rather
 *  than a procedure, because what arrives there is a browser expecting HTML. */
export const PAIR_CALLBACK_PATH = "/pair/callback";

/** What the approve page appends to the redirect. */
export const PAIR_CALLBACK_PARAMS = {
  code: "code",
  state: "state",
} as const;

/** Where the WEB deployment serves the approve page, and the four values the
 *  local app hands it. `challenge` is the PKCE S256 challenge the approve page
 *  forwards to the mint. */
export const PAIR_APPROVE_PATH = "/app/pair";
export const PAIR_APPROVE_PARAMS = {
  redirect: "redirect",
  state: "state",
  name: "name",
  challenge: "challenge",
} as const;

/**
 * The ONE host a pairing callback may name.
 *
 * `127.0.0.1`, and nothing else. The local app binds that literal and only that
 * literal, so `[::1]` names an address nothing here is listening on, and
 * `localhost` is a name a hostile resolver answers for. An allowlist wider than
 * the set of addresses that can actually answer is an open redirect with extra
 * steps — and this redirect carries a live pairing code.
 *
 * Exported because the local app has to AIM at it: the caller may have reached
 * the app on `localhost`, and the callback it is handed has to name the literal
 * this schema admits.
 */
export const PAIR_CALLBACK_HOST = "127.0.0.1";

/** 128 bits, hex. Large enough that a callback nobody initiated cannot be
 *  guessed, which is the whole of what `state` buys. */
export const PAIR_STATE_BYTES = 16;
export const PAIR_STATE_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Why `value` is not a pairing callback, or null when it is one.
 *
 * Parsed with `URL` and judged on its FIELDS, never matched as text. That is
 * what disarms the userinfo trick: `new URL("http://127.0.0.1@evil.com/…")`
 * parses to username `127.0.0.1` and hostname `evil.com`, so every check that
 * "saw 127.0.0.1 in there" was reading the wrong field. Here the credential
 * fields are required EMPTY and the host is read from `hostname` alone.
 */
function pairRedirectProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "is not an absolute URL";
  }
  if (url.protocol !== "http:") {
    // Loopback carries no TLS and needs none — the bytes never leave the
    // machine — so an https target is by definition somewhere else.
    return `must be http: (got "${url.protocol}")`;
  }
  if (url.username !== "" || url.password !== "") {
    return "must carry no userinfo";
  }
  if (url.hostname !== PAIR_CALLBACK_HOST) {
    return `must be ${PAIR_CALLBACK_HOST} (got "${url.hostname}")`;
  }
  // THE PORT IS DELIBERATELY UNCONSTRAINED, default included. A loopback
  // address is loopback whichever port it names, so a rule here would refuse
  // nothing dangerous — and `URL` normalises `:80` away for http, so demanding
  // an explicit one made an app bound to port 80 impossible to pair at all.
  if (url.pathname !== PAIR_CALLBACK_PATH) {
    return `must be ${PAIR_CALLBACK_PATH} (got "${url.pathname}")`;
  }
  if (url.search !== "" || url.hash !== "") {
    return "must carry no query or fragment — the code and state are appended to it";
  }
  return null;
}

/** The redirect allowlist, as a schema: a target refuses at PARSE, before any
 *  page can be rendered around it. */
export const pairRedirectUrlSchema = z.string().superRefine((value, ctx) => {
  const problem = pairRedirectProblem(value);
  if (problem !== null) {
    ctx.addIssue({ code: "custom", message: `a pairing callback ${problem}` });
  }
});

/**
 * What `/app/pair` is asked to approve.
 *
 * Unknown keys are STRIPPED rather than refused: the security property lives on
 * `redirect`, and a stray parameter picked up on the way through sign-in is no
 * reason to refuse a user their pairing.
 */
export const pairApproveSearchSchema = z.object({
  [PAIR_APPROVE_PARAMS.redirect]: pairRedirectUrlSchema,
  [PAIR_APPROVE_PARAMS.state]: z.string().regex(PAIR_STATE_PATTERN),
  [PAIR_APPROVE_PARAMS.name]: z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH),
  [PAIR_APPROVE_PARAMS.challenge]: z.string().regex(PKCE_S256_PATTERN),
});
export type PairApproveSearch = z.infer<typeof pairApproveSearchSchema>;

/** The approve page's URL, as the local app composes it. */
export function buildPairApproveUrl(cloudUrl: string, search: PairApproveSearch): string {
  const url = new URL(PAIR_APPROVE_PATH, cloudUrl);
  url.searchParams.set(PAIR_APPROVE_PARAMS.redirect, search.redirect);
  url.searchParams.set(PAIR_APPROVE_PARAMS.state, search.state);
  url.searchParams.set(PAIR_APPROVE_PARAMS.name, search.name);
  url.searchParams.set(PAIR_APPROVE_PARAMS.challenge, search.challenge);
  return url.toString();
}

/** The callback URL, as the approve page composes it once the user approves.
 *  `redirect` has already been through `pairRedirectUrlSchema` — that is what
 *  makes appending to it safe. */
export function buildPairCallbackUrl(
  redirect: string,
  args: { code: string; state: string },
): string {
  const url = new URL(redirect);
  url.searchParams.set(PAIR_CALLBACK_PARAMS.code, args.code);
  url.searchParams.set(PAIR_CALLBACK_PARAMS.state, args.state);
  return url.toString();
}
