import { AUTH_API_PATHS } from "@repo/contract/cloud/account/account-schema";
import { V1_SOCKET_PATH } from "@repo/contract/cloud/library/library-socket";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import { createAuth } from "./auth/auth";
import { handleInviteSignUp } from "./auth/invite";
import {
  CONSENT_PATH,
  connectorAuth,
  isAuthorizationServerPath,
  isConnectorPath,
} from "./connector/connector-auth";
import { handleConnector } from "./connector/connector-route";
import { handleConsent } from "./connector/consent-route";
import { answerPreflight, crossOriginPage, letPageRead } from "./cors";
import { consumeFills } from "./fill/fill-consumer";
import type { FillJob } from "./fill/fill-job";
import { handleLibrarySocket } from "./library/socket-routes";
import { handleBlobRoute, isBlobPath } from "./library/blob-routes";
import { handleExportRoute, isExportPath } from "./library/export-routes";
import { handleLibraryPage, isLibraryPagePath } from "./library/library-page";
import { logUnhandled } from "./log";
import { rpcFault } from "./wire/rpc-refusal";
import { handleV1Rpc } from "./wire/v1-rpc";

// Durable Object classes must be exported from the entry the runtime loads: this file for tests
// (vitest.config.ts's `main`), ./server.ts for deploy
// the suites' workerd instantiates each from this entry's exports
/** @public */
export { AgentThreadDO } from "./agent/agent-thread";
/** @public */
export { LibraryDO } from "./library/library-do";

// CORS for two origins alone, the Mac app's page, which its shell serves, and the browser
// extension's (./cors.ts): every other page is this Worker's own, and a reflected allow-origin
// beside a cookie-bearing auth surface would be worse than none.

// ./server.ts splits on these, so a route added below must be reachable through one or it never arrives
const OWNED_PREFIXES = ["/api/", "/v1/"] as const;

// the connector, its OAuth endpoints and its consent page, which no prefix of their own holds
const isConnectorRoute = (pathname: string): boolean =>
  isConnectorPath(pathname) || isAuthorizationServerPath(pathname) || pathname === CONSENT_PATH;

export const ownsPath = (pathname: string): boolean =>
  OWNED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
  isConnectorRoute(pathname) ||
  isLibraryPagePath(pathname);

const isRpc = (pathname: string): boolean => pathname.startsWith(`${V1_RPC_PATH}/`);

interface FrontDoor {
  readonly owns: (pathname: string) => boolean;
  readonly answer: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
}

// the doors answered whole before any floor: an assistant's, which names no build and takes no
// device credential (the token its OAuth endpoints minted, asked for on its consent page), and the
// library's page, its document from the assets for every path under its prefix
const FRONT_DOORS: readonly FrontDoor[] = [
  { answer: handleConnector, owns: isConnectorPath },
  {
    answer: async (request, env, ctx) =>
      await connectorAuth(env).authorizationServer.fetch(request, env, ctx),
    owns: isAuthorizationServerPath,
  },
  { answer: handleConsent, owns: (pathname) => pathname === CONSENT_PATH },
  {
    answer: async (request, env) => await handleLibraryPage(request, env.ASSETS),
    owns: isLibraryPagePath,
  },
];

const route = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  const url = new URL(request.url);

  const door = FRONT_DOORS.find(({ owns }) => owns(url.pathname));
  if (door !== undefined) {
    return await door.answer(request, env, ctx);
  }

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

  // an export's zip, behind the same floor and credential as a file
  if (isExportPath(url.pathname)) {
    return await handleExportRoute(request, env, ctx, url);
  }

  if (url.pathname.startsWith("/api/auth/")) {
    return await createAuth(env, ctx.exports, url.origin).handler(request);
  }

  // the site's sign-up form, which its own page posts and which ships in the same deploy
  if (request.method === "POST" && url.pathname === AUTH_API_PATHS.signUp) {
    return await handleInviteSignUp(request, env, ctx);
  }

  return new Response("not found", { status: 404 });
};

const answer = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  try {
    return await route(request, env, ctx);
  } catch (error) {
    logUnhandled("worker", request, error);
    const { pathname } = new URL(request.url);
    return isRpc(pathname) ? rpcFault() : new Response("internal error", { status: 500 });
  }
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const page = crossOriginPage(request, new URL(request.url).pathname);
    if (page === null) {
      return await answer(request, env, ctx);
    }
    if (request.method === "OPTIONS") {
      return answerPreflight(page);
    }
    return letPageRead(await answer(request, env, ctx), page);
  },
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
    await consumeFills(batch, env, ctx);
  },
} satisfies ExportedHandler<Env, FillJob>;
