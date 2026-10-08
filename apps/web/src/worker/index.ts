import { ACCOUNT_API_PATHS, AUTH_PAGE_PATHS } from "@repo/contract/cloud/account/account-schema";
import { createAuth } from "./auth/auth";
import { handleInviteSignUp } from "./auth/invite";
import { handleResetPage } from "./auth/reset-page";
import { refuse } from "./cloud-http";
import { handleAccountRoute } from "./device/account";
import { handleDeviceRoutes } from "./device/routes";
import { logUnhandled } from "./log";
import { handleSyncRoutes } from "./sync/routes";

// Durable Object classes must be exported from the entry the runtime loads: this file for tests, ./server.ts for deploy
export { ThreadSyncDO } from "./sync/thread-sync-do";

// No CORS: every browser client is served from this origin and a native app is not subject to
// it; a reflected allow-origin beside a cookie-bearing auth surface would be worse than none.

// ./server.ts splits on these, so a route added below must be reachable through one or it never arrives
const OWNED_PREFIXES = ["/api/", "/v1/", "/auth/"] as const;

export const ownsPath = (pathname: string): boolean =>
  OWNED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

// every client of /v1 parses the error envelope, and a bare-text 5xx reads to it as an
// unreachable cloud
const speaksCloudEnvelope = (pathname: string): boolean => pathname.startsWith("/v1/");

const route = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/auth/")) {
    return await createAuth(env, url.origin).handler(request);
  }

  if (request.method === "GET" && url.pathname === AUTH_PAGE_PATHS.resetPage) {
    return handleResetPage();
  }

  if (request.method === "POST" && url.pathname === AUTH_PAGE_PATHS.signUp) {
    return await handleInviteSignUp(request, env);
  }

  if (url.pathname.startsWith("/v1/device/")) {
    return await handleDeviceRoutes(request, env, url);
  }

  if (url.pathname.startsWith("/v1/sync/")) {
    return await handleSyncRoutes(request, env, url);
  }

  if (url.pathname === ACCOUNT_API_PATHS.account || url.pathname === ACCOUNT_API_PATHS.delete) {
    return await handleAccountRoute(request, env, url);
  }

  return speaksCloudEnvelope(url.pathname)
    ? refuse("not-found", "No such route.")
    : new Response("not found", { status: 404 });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      logUnhandled("worker", request, error);
      return speaksCloudEnvelope(new URL(request.url).pathname)
        ? refuse("internal", "Something went wrong on our side.")
        : new Response("internal error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
