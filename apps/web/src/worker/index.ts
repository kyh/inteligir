import { ACCOUNT_API_PATHS } from "@repo/api/cloud/account/account-schema";
import { VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { createAuth, enabledSocialProviders } from "./auth/auth";
import { handleInviteSignUp } from "./auth/invite";
import { handleResetPage } from "./auth/reset-page";
import { handleAccountRoute } from "./device/account";
import { handleDeviceRoutes } from "./device/routes";
import { logUnhandled } from "./log";
import { handleSyncRoutes } from "./sync/routes";
import { handleVaultGitRemote } from "./vault/git-remote";
import { handleVaultReadRoutes } from "./vault/read-routes";

// The Durable Object classes must be exported from the entry the runtime
// loads: this file for the test suite (vitest.config `main`), ./server.ts for
// deploy. RepoCell/Registry are durable-git's — the vault repo cells and
// their name index.
export { ThreadSyncDO } from "./sync/thread-sync-do";
export { RepoCell, Registry } from "durable-git";

// ---------------------------------------------------------------------------
// The API half of the one Worker this app deploys (./server.ts routes
// `OWNED_PREFIXES` here and everything else to the marketing site's SSR
// handler).
//
// Two surfaces, split by CREDENTIAL:
//
//   • The account surface — /api/auth/* (Better Auth), the invite gate, the
//     capability probe, the reset page, and /v1/device/* (pairing mint, the
//     dashboard's device table). AUTH is a Better Auth SESSION: the cookie a
//     browser on this origin carries, or `Authorization: Bearer
//     <session-token>` for a native client.
//   • The device surface — /v1/sync/*, /v1/capture, /v1/git/*. AUTH is the
//     durable DEVICE CREDENTIAL pairing minted (`igd_…` bearer, hash compare
//     per request, never cached). Sync and capture are served by the caller's
//     own ThreadSyncDO (src/worker/sync/); the vault git remote by the
//     caller's own RepoCell (src/worker/vault/).
//
// `POST /v1/device/redeem` is the bridge between the two: the one-time code a
// session minted is its whole authorization.
//
// NO CORS. Every browser client is served by this same Worker from this same
// origin, and the one cross-origin caller left — a native app — is not a
// browser and is not subject to CORS at all. Adding the headers back would be
// worse than useless: a reflected `access-control-allow-origin` is harmless
// only while `allow-credentials` is absent, and the auth surface here is
// cookie-bearing.
//
// ERRORS. `fetch` wraps the whole route table so an unhandled throw becomes one
// structured log line (src/worker/log.ts) plus an opaque 500 — workerd's own
// unhandled-exception 500 is unlogged, so the client sees an unexplained
// network failure and `wrangler tail` shows nothing.
// ---------------------------------------------------------------------------

/**
 * The path prefixes this surface owns. `./server.ts` splits on them, so a route
 * added below must be reachable through one of these or it never arrives.
 * `/auth/` is claimed whole: the reset page is the Worker's, not the site's.
 */
const OWNED_PREFIXES = ["/api/", "/v1/", "/auth/"] as const;

/** True when `pathname` belongs to this API surface rather than the site. */
export function ownsPath(pathname: string): boolean {
  return OWNED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      logUnhandled("worker", request, error);
      return new Response("internal error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

/** The route table. Throws are caught by the `fetch` wrapper above. */
async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  // Better Auth surface. baseURL = this request's origin so callbacks/cookies
  // match whatever host served the request (localhost/preview/prod).
  if (url.pathname.startsWith("/api/auth/")) {
    return await createAuth(env, url.origin).handler(request);
  }

  // Password-reset page: where the email link's GET leg redirects
  // with `?token=` (or `?error=`). Static + no-store; the page submits to
  // Better Auth's POST /api/auth/reset-password on this same origin.
  if (request.method === "GET" && url.pathname === "/auth/reset") {
    return handleResetPage();
  }

  // Capability discovery — which social providers this deployment serves,
  // so clients render exactly the configured buttons (env-gated end to
  // end). Unauthenticated by design: it reveals nothing a sign-in page
  // wouldn't.
  if (request.method === "GET" && url.pathname === "/v1/capabilities") {
    return Response.json({ socialProviders: enabledSocialProviders(env) });
  }

  // Sign-up, invite-gated (see src/worker/auth/invite.ts). It claims a code and
  // then forwards to Better Auth's own sign-up, so what comes back — cookie,
  // bearer, validation errors — is Better Auth's response untouched.
  if (request.method === "POST" && url.pathname === "/v1/auth/sign-up") {
    return await handleInviteSignUp(request, env);
  }

  // Device pairing (session-authed except redeem, where the code is the
  // credential) — src/worker/device/routes.ts.
  if (url.pathname.startsWith("/v1/device/")) {
    return await handleDeviceRoutes(request, env, url);
  }

  // The device-authed sync surface, served by the caller's own ThreadSyncDO —
  // src/worker/sync/routes.ts.
  if (url.pathname === "/v1/capture" || url.pathname.startsWith("/v1/sync/")) {
    return await handleSyncRoutes(request, env, url);
  }

  // The hosted vault git remote, device-authed — src/worker/vault/git-remote.ts.
  if (url.pathname.startsWith(VAULT_GIT_PATH)) {
    return await handleVaultGitRemote(request, env, ctx, url);
  }

  // The vault READ rows a git-less client (the phone) uses, device-authed —
  // src/worker/vault/read-routes.ts.
  if (
    url.pathname === VAULT_API_PATHS.tree ||
    url.pathname === VAULT_API_PATHS.file ||
    url.pathname === VAULT_API_PATHS.asset
  ) {
    return await handleVaultReadRoutes(request, env, url);
  }

  // Whose account a device credential syncs as — src/worker/device/account.ts.
  if (url.pathname === ACCOUNT_API_PATHS.account) {
    return await handleAccountRoute(request, env);
  }

  return new Response("not found", { status: 404 });
}
