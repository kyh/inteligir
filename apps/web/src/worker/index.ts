import { createAuth, enabledSocialProviders } from "./auth/auth";
import { handleInviteSignUp } from "./auth/invite";
import { handleResetPage } from "./auth/reset-page";
import { logUnhandled } from "./log";

// ---------------------------------------------------------------------------
// The API half of the one Worker this app deploys (./server.ts routes
// `OWNED_PREFIXES` here and everything else to the marketing site's SSR
// handler).
//
// One surface: /api/auth/* — Better Auth (email+password, bearer), running
// in-process over Drizzle + D1 (`createAuth(env).handler`) — plus the invite
// gate, the capability probe and the reset page around it.
//
// AUTH is a Better Auth SESSION throughout, in one of two shapes: the session
// COOKIE a browser on this origin carries, or `Authorization: Bearer
// <session-token>` for a native client (the token comes back in the
// `set-auth-token` header on sign-in/up, and the bearer plugin lets
// `auth.api.getSession({ headers })` validate it in-process).
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
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      logUnhandled("worker", request, error);
      return new Response("internal error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

/** The route table. Throws are caught by the `fetch` wrapper above. */
async function route(request: Request, env: Env): Promise<Response> {
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

  return new Response("not found", { status: 404 });
}
