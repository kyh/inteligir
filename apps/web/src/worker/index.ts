import { routeAgentReport, routeOAuthCallback } from "./agent/agent-route";
import { AgentSandbox } from "./agent/sandbox-class";
import { createAuth, enabledSocialProviders } from "./auth/auth";
import { routeDeepLink } from "./capture/deep-link-route";
import { handleDesktopCallback, handleSessionExchange } from "./auth/desktop-session";
import { handleInviteSignUp } from "./auth/invite";
import { handleResetPage } from "./auth/reset-page";
import { routeHostAsset } from "./host/asset-route";
import { UserHost } from "./host/user-host";
import { routeHostSocket } from "./host/ws-route";
import { logUnhandled } from "./log";

// ---------------------------------------------------------------------------
// The API half of the one Worker this app deploys (./server.ts routes
// `OWNED_PREFIXES` here and everything else to the marketing site's SSR
// handler).
//
// Two surfaces:
//   • /api/auth/*  — Better Auth (email+password, bearer), running in-process
//     over Drizzle + D1 (`createAuth(env).handler`).
//   • the workspace host — one `UserHost` Durable Object per user, reached
//     over a WebSocket (host/ws-route.ts) plus the one streamed HTTP upload
//     the Bridge cannot carry (host/asset-route.ts). The user's vault lives
//     inside that object: its manifest in the DO's SQLite, its bytes in R2.
//
// AUTH is a Better Auth SESSION throughout: `Authorization: Bearer
// <session-token>` (the token comes back in the `set-auth-token` header on
// sign-in/up), and the bearer plugin lets `auth.api.getSession({ headers })`
// validate it in-process. A user reaches exactly one host object, named after
// their user id, so there is no ownership table to consult.
//
// CORS. Desktop (Electron) and mobile (Expo) call cross-origin, so every
// response carries CORS headers and `OPTIONS` is answered as a preflight.
//
// ERRORS. `fetch` wraps the whole route table so an unhandled throw becomes one
// structured log line (src/worker/log.ts) plus an opaque 500 that still carries CORS
// headers — workerd's own unhandled-exception 500 has neither, so the client
// sees an unexplained network failure and `wrangler tail` shows nothing.
// ---------------------------------------------------------------------------

// This module is also the test suite's Worker entry (vitest.config.ts `main`),
// and a Durable Object binding resolves its class against the entry's exports —
// so dropping this re-export 500s every DO-backed test.
export { UserHost };
// The Sandbox subclass and the SDK's ContainerProxy BOTH have to be exported
// from the Worker entry or the container never deploys and outbound
// interception never installs — the second failure is silent, which is what
// makes it worth naming here (see ./agent/sandbox-class).
export { AgentSandbox };
export { ContainerProxy } from "@cloudflare/sandbox";

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

/** Response headers clients must be able to read cross-origin. */
const EXPOSED_HEADERS = "set-auth-token";

/** Re-emit `response` with CORS headers derived from the request `Origin`. */
function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  // Bearer auth carries no cookies, so credentials aren't needed and reflecting
  // the origin (or `*` when absent) is safe. Vary on Origin when we reflect one.
  headers.set("access-control-allow-origin", origin ?? "*");
  if (origin !== null) headers.append("vary", "origin");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "Authorization, Content-Type");
  headers.set("access-control-expose-headers", EXPOSED_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

  // Sign-up, invite-gated (see src/worker/auth/invite.ts). It claims a code and
  // then forwards to Better Auth's own sign-up, so what comes back — cookie,
  // bearer, validation errors — is Better Auth's response untouched.
  if (request.method === "POST" && url.pathname === "/v1/auth/sign-up") {
    return withCors(request, await handleInviteSignUp(request, env));
  }

  // Desktop social-login handoff (see src/worker/auth/desktop-session.ts): the
  // browser lands on the callback with the session COOKIE Better Auth just
  // set; the desktop later burns the minted single-use code over HTTPS. The
  // deep link between them carries only the opaque code — never a token.
  if (request.method === "GET" && url.pathname === "/v1/auth/desktop-callback") {
    return withCors(request, await handleDesktopCallback(request, env, ctx));
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/exchange") {
    return withCors(request, await handleSessionExchange(request, env));
  }

  // The container's report — everything an agent turn produces, arriving as
  // short authenticated requests so no Durable Object ever awaits a turn.
  const report = await routeAgentReport(request, env, url.pathname);
  if (report !== null) return withCors(request, report);

  // The provider OAuth redirect. Not CORS-relevant (a browser navigation, not
  // a fetch), but wrapped like everything else so one response shape holds.
  const oauth = await routeOAuthCallback(request, env, url.pathname);
  if (oauth !== null) return withCors(request, oauth);

  // The workspace's Bridge socket. Answered BEFORE the CORS wrapper below: a
  // 101 carries a `webSocket` that re-emitting the response would drop, and a
  // WebSocket handshake is not CORS-preflighted anyway — its Origin is checked
  // against an exact allowlist instead (host/origins.ts).
  const socket = await routeHostSocket(request, env, url.pathname);
  if (socket !== null) return socket;

  // Attachment upload — the one workspace capability that cannot fit in a
  // Bridge frame, so it arrives as a streamed HTTP body instead (see
  // host/asset-route.ts). CORS-wrapped like every other API response.
  const asset = await routeHostAsset(request, env, url.pathname);
  if (asset !== null) return withCors(request, asset);

  // The web scheme's front door — what `inteligir://` was (see
  // capture/deep-link-route.ts). Authenticated like the upload, because a
  // capture writes to the user's vault.
  const link = await routeDeepLink(request, env, url.pathname);
  if (link !== null) return withCors(request, link);

  return withCors(request, new Response("not found", { status: 404 }));
}
