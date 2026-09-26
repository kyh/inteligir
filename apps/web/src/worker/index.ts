import { ACCOUNT_API_PATHS, AUTH_PAGE_PATHS } from "@repo/api/cloud/account/account-schema";
import { VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { createAuth } from "./auth/auth";
import { handleInviteSignUp } from "./auth/invite";
import { handleResetPage } from "./auth/reset-page";
import { refuse } from "./cloud-http";
import { handleAccountRoute } from "./device/account";
import { handleDeviceRoutes } from "./device/routes";
import { logUnhandled } from "./log";
import { handleSyncRoutes } from "./sync/routes";
import { handleVaultCommitRoute } from "./vault/commit-route";
import { handleVaultGitRemote } from "./vault/git-remote";
import { handleVaultReadRoutes } from "./vault/read-routes";

// Durable Object classes must be exported from the entry the runtime loads: this file for tests, ./server.ts for deploy
export { ThreadSyncDO } from "./sync/thread-sync-do";
export { RepoCell, Registry } from "durable-git";

// No CORS: every browser client is served from this origin and a native app is not subject to
// it; a reflected allow-origin beside a cookie-bearing auth surface would be worse than none.

// ./server.ts splits on these, so a route added below must be reachable through one or it never arrives
const OWNED_PREFIXES = ["/api/", "/v1/", "/auth/"] as const;

export const ownsPath = (pathname: string): boolean =>
  OWNED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

// every client of /v1 parses the error envelope, and a bare-text 5xx reads to it as an
// unreachable cloud; the git mount answers git clients, whose stderr would print JSON as noise
const speaksCloudEnvelope = (pathname: string): boolean =>
  pathname.startsWith("/v1/") && !pathname.startsWith(VAULT_GIT_PATH);

const route = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
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

  if (url.pathname === "/v1/capture" || url.pathname.startsWith("/v1/sync/")) {
    return await handleSyncRoutes(request, env, url);
  }

  if (url.pathname.startsWith(VAULT_GIT_PATH)) {
    return await handleVaultGitRemote(request, env, ctx, url);
  }

  if (url.pathname === VAULT_API_PATHS.commit) {
    return await handleVaultCommitRoute(request, env, ctx);
  }

  if (
    url.pathname === VAULT_API_PATHS.tree ||
    url.pathname === VAULT_API_PATHS.file ||
    url.pathname === VAULT_API_PATHS.files ||
    url.pathname === VAULT_API_PATHS.asset
  ) {
    return await handleVaultReadRoutes(request, env, url);
  }

  if (url.pathname === ACCOUNT_API_PATHS.account || url.pathname === ACCOUNT_API_PATHS.delete) {
    return await handleAccountRoute(request, env, url);
  }

  return speaksCloudEnvelope(url.pathname)
    ? refuse("not-found", "No such route.")
    : new Response("not found", { status: 404 });
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      logUnhandled("worker", request, error);
      return speaksCloudEnvelope(new URL(request.url).pathname)
        ? refuse("internal", "Something went wrong on our side.")
        : new Response("internal error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
