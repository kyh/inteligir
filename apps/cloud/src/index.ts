import { HEADER_CONTENT_HASH, HEADER_VERSION, isValidVaultId } from "@repo/notes/sync/wire";
import { eq } from "drizzle-orm";
import { createAuth, enabledSocialProviders } from "./auth/auth";
import { handleDesktopCallback, handleSessionExchange } from "./auth/desktop-session";
import { handleResetPage } from "./auth/reset-page";
import { createDb } from "./db/client";
import { vaultOwner } from "./db/schema";
import { readDeviceAssertion, unauthorized, verifyDeviceAssertion } from "./device-assertion";
import { logUnhandled } from "./log";
import { allowInWindow, callerIp, type RateWindow } from "./rate-limit";
import { isDeviceRoute, matchRoute, type VaultRouteMatch } from "./route";
import { VaultCoordinator } from "./vault-coordinator";

// ---------------------------------------------------------------------------
// Worker entry for the vault-sync backend + Better Auth.
//
// ONE Worker serves two surfaces:
//   • /api/auth/*  — Better Auth (email+password, bearer), running in-process
//     over Drizzle + D1 (`createAuth(env).handler`).
//   • /v1/vault/*  — the sync routes (`@repo/notes/sync/wire`), forwarded to the
//     per-vault `VaultCoordinator` Durable Object after auth.
//
// AUTH. There are TWO credentials on the sync surface, and the bearer string
// itself says which:
//
//   • A DEVICE ASSERTION — self-issued, 5-minute, Ed25519-signed (see
//     src/device-assertion.ts). Verified statelessly here; the Durable Object
//     independently re-verifies and answers membership. A vaultId under this
//     model is the fingerprint of its founding key, so there is no ownership
//     table to consult and D1 is not touched at all.
//   • A BETTER AUTH SESSION — `Authorization: Bearer <session-token>` (the
//     token comes back in the `set-auth-token` header on sign-in/up). The
//     bearer plugin lets `auth.api.getSession({ headers })` validate it
//     in-process. Ownership is first-writer-wins: the first authenticated user
//     to touch a vaultId claims it in the `vault_owner` table; a later request
//     for that vault by a different user is 403.
//
// A bearer that PARSES as an assertion is judged as one and never falls back to
// the session path; anything else goes to Better Auth — EXCEPT on a vaultId of
// the self-certifying `v1…` shape, which only a key can own. A session reaching
// one would let an account holder claim and write a vault no device founded,
// which is the whole property the naming scheme exists to give. Every vaultId
// the account model ever minted is a UUID, so the refusal costs nothing live.
//
// The device-identity routes (enroll/devices/revoke) accept only device
// credentials, so a session can never reach into the device model or the
// reverse.
//
// Rejecting a device credential here, before `getByName`, keeps a MALFORMED id
// from ever naming a Durable Object, and the enrollment budget bounds `enroll`,
// the one route that arrives with no credential at all.
//
// It does NOT stop a stranger instantiating DOs. Anyone can generate a keypair
// offline and self-sign an assertion for any well-shaped `v1…` id: the
// signature verifies against the key inside it, so the Worker has nothing to
// object to and the DO runs before answering `device-not-enrolled`. Closing
// that would need the roster, which lives in the DO — an enrolled non-founding
// device and a stranger are indistinguishable until it is consulted. Accepted
// residual, recorded in the README; the cost is an empty DO, not vault access.
//
// CORS. Desktop (Electron) and mobile (Expo) call cross-origin, so every response
// (auth + sync) carries CORS headers and `OPTIONS` is answered as a preflight.
//
// ERRORS. `fetch` wraps the whole route table so an unhandled throw becomes one
// structured log line (src/log.ts) plus an opaque 500 that still carries CORS
// headers — workerd's own unhandled-exception 500 has neither, so the client
// sees an unexplained network failure and `wrangler tail` shows nothing.
// ---------------------------------------------------------------------------

export { VaultCoordinator };

/**
 * Enrollment budget on the credential-free redeem route: 10 attempts / 60s per
 * IP, the same shape the auth routes and the code exchange use. It bounds two
 * things at once — offer-secret guessing, and the number of Durable Objects an
 * anonymous caller can bring into existence by naming them.
 */
const ENROLL_WINDOW: RateWindow = { max: 10, windowMs: 60_000 };
const ENROLL_RATE_KEY_PREFIX = "vault-enroll:";

/** Response headers clients must be able to read cross-origin. */
const EXPOSED_HEADERS = [HEADER_VERSION, HEADER_CONTENT_HASH, "set-auth-token"].join(", ");

/** Re-emit `response` with CORS headers derived from the request `Origin`. */
function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  // Bearer auth carries no cookies, so credentials aren't needed and reflecting
  // the origin (or `*` when absent) is safe. Vary on Origin when we reflect one.
  headers.set("access-control-allow-origin", origin ?? "*");
  if (origin !== null) headers.append("vary", "origin");
  headers.set("access-control-allow-methods", "GET,PUT,DELETE,POST,OPTIONS");
  headers.set("access-control-allow-headers", "Authorization, Content-Type, x-base-version");
  headers.set("access-control-expose-headers", EXPOSED_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * First-writer-wins ownership. Returns true iff `userId` may act on `vaultId`:
 * the existing owner matches, or the vault is unclaimed (then claim it). The
 * claim is racey — two first-touch requests can both find it absent — so we
 * insert with `onConflictDoNothing` and re-read to settle on the single winner.
 */
async function ownsVault(db: ReturnType<typeof createDb>, vaultId: string, userId: string) {
  const existing = await db
    .select({ userId: vaultOwner.userId })
    .from(vaultOwner)
    .where(eq(vaultOwner.vaultId, vaultId))
    .get();
  if (existing !== undefined) return existing.userId === userId;

  await db.insert(vaultOwner).values({ vaultId, userId }).onConflictDoNothing();
  const owner = await db
    .select({ userId: vaultOwner.userId })
    .from(vaultOwner)
    .where(eq(vaultOwner.vaultId, vaultId))
    .get();
  return owner !== undefined && owner.userId === userId;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      logUnhandled("worker", request, error);
      return withCors(request, new Response("internal error", { status: 500 }));
    }
  },
} satisfies ExportedHandler<Env>;

/** The route table. Throws are caught by the `fetch` wrapper above. */
async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  // CORS preflight — answer before any auth/routing work.
  if (request.method === "OPTIONS") {
    return withCors(request, new Response(null, { status: 204 }));
  }

  // Better Auth surface. baseURL = this request's origin so callbacks/cookies
  // match whatever host served the request (localhost/preview/prod).
  if (url.pathname.startsWith("/api/auth/")) {
    return withCors(request, await createAuth(env, url.origin).handler(request));
  }

  // Password-reset page: where the email link's GET leg redirects
  // with `?token=` (or `?error=`). Static + no-store; the page submits to
  // Better Auth's POST /api/auth/reset-password on this same origin.
  if (request.method === "GET" && url.pathname === "/auth/reset") {
    return withCors(request, handleResetPage());
  }

  // Capability discovery — which social providers this deployment serves,
  // so clients render exactly the configured buttons (env-gated end to
  // end). Unauthenticated by design: it reveals nothing a sign-in page
  // wouldn't.
  if (request.method === "GET" && url.pathname === "/v1/capabilities") {
    return withCors(request, Response.json({ socialProviders: enabledSocialProviders(env) }));
  }

  // Desktop social-login handoff (see src/auth/desktop-session.ts): the
  // browser lands on the callback with the session COOKIE Better Auth just
  // set; the desktop later burns the minted single-use code over HTTPS. The
  // deep link between them carries only the opaque code — never a token.
  if (request.method === "GET" && url.pathname === "/v1/auth/desktop-callback") {
    return withCors(request, await handleDesktopCallback(request, env, ctx));
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/exchange") {
    return withCors(request, await handleSessionExchange(request, env));
  }

  // Sync surface.
  const match = matchRoute(request.method, url.pathname, url.search);
  if (match.kind === "unmatched") {
    return withCors(request, new Response("not found", { status: 404 }));
  }

  const refusal = await authorizeVault(request, env, url.origin, match);
  if (refusal !== null) return withCors(request, refusal);

  // `getByName` is `get(idFromName(name))` in one call — same addressing.
  return withCors(request, await env.VaultCoordinator.getByName(match.vaultId).fetch(request));
}

/** Refuse the request, or `null` to forward it to the vault's Durable Object. */
async function authorizeVault(
  request: Request,
  env: Env,
  origin: string,
  match: VaultRouteMatch,
): Promise<Response | null> {
  const assertion = readDeviceAssertion(request.headers);

  // The device-identity routes exist only under the device model.
  if (isDeviceRoute(match)) {
    // The shape check is load-bearing on the unauthenticated `enroll` route:
    // without it a caller names arbitrary strings and spins up DOs.
    if (!isValidVaultId(match.vaultId)) return unauthorized("invalid-vault-id");
    if (match.kind === "enroll") return throttleEnroll(request, env);
    if (assertion === null) return unauthorized("missing-credential");
  }

  if (assertion !== null) {
    const verdict = await verifyDeviceAssertion(assertion, match.vaultId, nowSeconds());
    return verdict.ok ? null : unauthorized(verdict.reason);
  }

  // A self-certifying vaultId belongs to whoever holds its founding key, and to
  // nobody else — an account may not claim (or write) one, founded or not.
  if (isValidVaultId(match.vaultId)) return unauthorized("device-credential-required");

  // Authenticate: the bearer plugin reads `Authorization: Bearer …`.
  const auth = createAuth(env, origin);
  const authResult = await auth.api.getSession({ headers: request.headers });
  if (authResult === null) return new Response("unauthorized", { status: 401 });

  // Authorize: the caller must own (or be the first to claim) this vault.
  const db = createDb(env.DB);
  if (!(await ownsVault(db, match.vaultId, authResult.user.id))) {
    return new Response("forbidden", { status: 403 });
  }
  return null;
}

/**
 * Spend one unit of this caller's enrollment budget. `null` forwards the redeem
 * to the vault's Durable Object; over budget is a 429 that never addresses one.
 */
async function throttleEnroll(request: Request, env: Env): Promise<Response | null> {
  if (env.RATE_LIMIT_DISABLED === "true") return null;
  const key = `${ENROLL_RATE_KEY_PREFIX}${callerIp(request)}`;
  if (await allowInWindow(createDb(env.DB), key, Date.now(), ENROLL_WINDOW)) return null;
  return new Response("rate limited", { status: 429 });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
