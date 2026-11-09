import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import { V1_SOCKET_PATH } from "@repo/contract/library/library-socket";
import { V1_RPC_PATH } from "@repo/contract/v1";
import { createAuth, withoutAuthToken } from "./auth/auth";
import { handleInviteSignUp } from "./auth/invite";
import {
  CONSENT_PATH,
  connectorAuth,
  isAuthorizationServerPath,
  isConnectorPath,
} from "./connector/connector-auth";
import { handleConnector } from "./connector/connector-route";
import { handleConsent } from "./connector/consent-route";
import { handleLibrarySocket } from "./library/socket-routes";
import { handleBlobRoute, isBlobPath } from "./library/blob-routes";
import { handleLibraryPage, isLibraryPagePath } from "./library/library-page";
import { logUnhandled } from "./log";
import { rpcFault } from "./wire/rpc-refusal";
import { handleV1Rpc } from "./wire/v1-rpc";

// the app's server.ts splits on these, so a route added below must be reachable through one or it
// never arrives
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
// session (the token its OAuth endpoints minted, asked for on its consent page), and the library's
// page, its document from the assets for every path under its prefix
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

  // the library's files: the floor and the session checked as the wire checks them
  if (isBlobPath(url.pathname)) {
    return await handleBlobRoute(request, env, ctx, url);
  }

  if (url.pathname.startsWith("/api/auth/")) {
    return withoutAuthToken(await createAuth(env, ctx, url.origin).handler(request));
  }

  // the site's sign-up form, which its own page posts and which ships in the same deploy
  if (request.method === "POST" && url.pathname === AUTH_API_PATHS.signUp) {
    return await handleInviteSignUp(request, env, ctx);
  }

  return new Response("not found", { status: 404 });
};

export const answerDoor = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  try {
    return await route(request, env, ctx);
  } catch (error) {
    logUnhandled(request, error);
    const { pathname } = new URL(request.url);
    return isRpc(pathname) ? rpcFault() : new Response("internal error", { status: 500 });
  }
};
