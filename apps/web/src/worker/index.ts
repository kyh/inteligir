import { ACCOUNT_API_PATHS, AUTH_API_PATHS } from "@repo/contract/cloud/account/account-schema";
import { V1_SOCKET_PATH } from "@repo/contract/cloud/library/library-socket";
import { SYNC_WS_PATH } from "@repo/contract/cloud/sync/sync-ws";
import { VAULT_GIT_PATH } from "@repo/contract/cloud/vault/vault-git";
import { VAULT_API_PATHS } from "@repo/contract/cloud/vault/vault-schema";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import { createAuth } from "./auth/auth";
import { handleInviteSignUp } from "./auth/invite";
import { refuseBelowFloor } from "./client-floor";
import { refuse } from "./cloud-http";
import { handleAccountRoute } from "./device/account";
import { handleDeviceRoutes } from "./device/routes";
import { handleLibrarySocket, handleSyncSocket } from "./library/socket-routes";
import { handleBlobRoute, isBlobPath } from "./library/blob-routes";
import { logUnhandled } from "./log";
import { rpcFault } from "./wire/rpc-refusal";
import { handleV1Rpc } from "./wire/v1-rpc";
import { handleVaultCommitRoute } from "./vault/commit-route";
import { handleVaultGitRemote } from "./vault/git-remote";
import { handleVaultReadRoutes, isVaultReadPath } from "./vault/read-routes";

// Durable Object classes must be exported from the entry the runtime loads: this file for tests, ./server.ts for deploy
export { LibraryDO } from "./library/library-do";
export { RepoCell, Registry } from "durable-git";

// No CORS: every browser client is served from this origin and a native app is not subject to
// it; a reflected allow-origin beside a cookie-bearing auth surface would be worse than none.

// ./server.ts splits on these, so a route added below must be reachable through one or it never arrives
const OWNED_PREFIXES = ["/api/", "/v1/"] as const;

export const ownsPath = (pathname: string): boolean =>
  OWNED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

const isRpc = (pathname: string): boolean => pathname.startsWith(`${V1_RPC_PATH}/`);

// every REST client of /v1 parses the error envelope, and a bare-text 5xx reads to it as an
// unreachable cloud; the git mount answers git clients, whose stderr would print JSON as noise,
// the one wire answers in its own protocol, and a file's bytes in HTTP's statuses alone
const speaksCloudEnvelope = (pathname: string): boolean =>
  pathname.startsWith("/v1/") &&
  !pathname.startsWith(VAULT_GIT_PATH) &&
  !isRpc(pathname) &&
  !isBlobPath(pathname);

const route = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  const url = new URL(request.url);

  // a browser's socket cannot name its build, and its ticket came from a call that met the floor
  if (url.pathname === V1_SOCKET_PATH) {
    return await handleLibrarySocket(request, env, ctx, url);
  }

  // the one wire: its own floor, credential and refusals, all in its protocol
  if (isRpc(url.pathname)) {
    return await handleV1Rpc(request, env, ctx, url);
  }

  // the library's files: the floor and the credential checked as the wire checks them
  if (isBlobPath(url.pathname)) {
    return await handleBlobRoute(request, env, ctx, url);
  }

  // before any route reads the request, so a shape retired behind the floor is never parsed
  const outdated = url.pathname.startsWith("/v1/")
    ? refuseBelowFloor(request, env, speaksCloudEnvelope(url.pathname))
    : null;
  if (outdated !== null) {
    return outdated;
  }

  if (url.pathname.startsWith("/api/auth/")) {
    return await createAuth(env, ctx.exports, url.origin).handler(request);
  }

  if (request.method === "POST" && url.pathname === AUTH_API_PATHS.signUp) {
    return await handleInviteSignUp(request, env, ctx);
  }

  if (url.pathname.startsWith("/v1/device/")) {
    return await handleDeviceRoutes(request, env, ctx, url);
  }

  if (url.pathname === SYNC_WS_PATH) {
    return await handleSyncSocket(request, env, ctx);
  }

  if (url.pathname.startsWith(VAULT_GIT_PATH)) {
    return await handleVaultGitRemote(request, env, ctx, url);
  }

  if (url.pathname === VAULT_API_PATHS.commit) {
    return await handleVaultCommitRoute(request, env, ctx);
  }

  if (isVaultReadPath(url.pathname)) {
    return await handleVaultReadRoutes(request, env, url.pathname);
  }

  if (url.pathname === ACCOUNT_API_PATHS.delete) {
    return await handleAccountRoute(request, env, ctx, url);
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
      const { pathname } = new URL(request.url);
      if (isRpc(pathname)) {
        return rpcFault();
      }
      return speaksCloudEnvelope(pathname)
        ? refuse("internal", "Something went wrong on our side.")
        : new Response("internal error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
