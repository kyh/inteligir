import { ACCOUNT_API_PATHS } from "@repo/api/cloud/account/account-schema";
import { VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { createAuth } from "./auth/auth";
import { handleInviteSignUp } from "./auth/invite";
import { handleResetPage } from "./auth/reset-page";
import { handleAccountRoute } from "./device/account";
import { handleDeviceRoutes } from "./device/routes";
import { logUnhandled } from "./log";
import { handleSyncRoutes } from "./sync/routes";
import { handleVaultGitRemote } from "./vault/git-remote";
import { handleVaultReadRoutes } from "./vault/read-routes";

// Durable Object classes must be exported from the entry the runtime loads: this file for tests, ./server.ts for deploy
export { ThreadSyncDO } from "./sync/thread-sync-do";
export { RepoCell, Registry } from "durable-git";

// No CORS: every browser client is served from this origin and a native app is not subject to
// it; a reflected allow-origin beside a cookie-bearing auth surface would be worse than none.

// ./server.ts splits on these, so a route added below must be reachable through one or it never arrives
const OWNED_PREFIXES = ["/api/", "/v1/", "/auth/"] as const;

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

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/auth/")) {
    return await createAuth(env, url.origin).handler(request);
  }

  if (request.method === "GET" && url.pathname === "/auth/reset") {
    return handleResetPage();
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/sign-up") {
    return await handleInviteSignUp(request, env);
  }

  if (url.pathname.startsWith("/v1/device/")) {
    return await handleDeviceRoutes(request, env, url);
  }

  if (url.pathname === "/v1/capture" || url.pathname.startsWith("/v1/sync/")) {
    return await handleSyncRoutes(request, env, url);
  }

  if (url.pathname.startsWith(VAULT_GIT_PATH)) {
    return await handleVaultGitRemote(request, env, ctx, url);
  }

  if (
    url.pathname === VAULT_API_PATHS.tree ||
    url.pathname === VAULT_API_PATHS.file ||
    url.pathname === VAULT_API_PATHS.asset
  ) {
    return await handleVaultReadRoutes(request, env, url);
  }

  if (url.pathname === ACCOUNT_API_PATHS.account) {
    return await handleAccountRoute(request, env);
  }

  return new Response("not found", { status: 404 });
}
