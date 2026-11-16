// The service's one way in: a Start mount hands it every request under its prefix
// (apps/web/src/routes), and the path's row in `./door-routes` names the door that answers. Bound to
// this request's bindings and the ExecutionContext Cloudflare handed the entry: the connector's
// OAuth provider writes `ctx.props` and `ctx.auth` on that very object and the connector reads them
// back, so the service is built per request, never kept.

import { createAuth, isClientRoute, withoutAuthToken } from "./auth/auth";
import { handleInviteSignUp } from "./auth/invite";
import { connectorAuth } from "./connector/connector-auth";
import { handleConnector } from "./connector/connector-route";
import { handleConsent } from "./connector/consent-route";
import { doorAt } from "./door-routes";
import type { DoorName } from "./door-routes";
import { handleBlobRoute } from "./library/blob-routes";
import { handleLibrarySocket } from "./library/socket-routes";
import { logUnhandled } from "./log";
import { handleNoteSocket } from "./note/note-routes";
import { rpcFault } from "./wire/rpc-refusal";
import { handleV1Rpc } from "./wire/v1-rpc";

// every door answers its own methods
type Door = (request: Request, env: Env, ctx: ExecutionContext, url: URL) => Promise<Response>;

const notFound = (): Response => new Response("not found", { status: 404 });

const internalError = (): Response => new Response("internal error", { status: 500 });

const authorizationServer: Door = async (request, env, ctx) =>
  await connectorAuth(env).authorizationServer.fetch(request, env, ctx);

const DOORS: Record<DoorName, Door> = {
  auth: async (request, env, ctx, url) =>
    isClientRoute(request.method, url.pathname)
      ? withoutAuthToken(await createAuth(env, ctx, url.origin).handler(request))
      : notFound(),
  // the site's sign-up form, which its own page posts and which ships in the same deploy
  signUp: async (request, env, ctx) =>
    request.method === "POST" ? await handleInviteSignUp(request, env, ctx) : notFound(),
  // the one wire: its admission and its refusals, all in its protocol
  rpc: handleV1Rpc,
  // the library's files, admitted as the wire's calls are
  blobs: handleBlobRoute,
  // a browser's socket cannot name its build, and its ticket came from a call that met the floor
  socket: handleLibrarySocket,
  // an item's note, opened on the same ticket as the account's socket
  note: handleNoteSocket,
  // an assistant's door, which names no build and takes no session: the token the provider's
  // endpoints minted, asked for on the consent page
  connector: handleConnector,
  connectorMetadata: handleConnector,
  authorizationServerMetadata: authorizationServer,
  oauthToken: authorizationServer,
  oauthRegister: authorizationServer,
  consent: handleConsent,
};

export const serviceFor =
  (env: Env, ctx: ExecutionContext) =>
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const name = doorAt(url.pathname);
    // a mount takes more than the table names: its prefix bare, a trailing slash, another case
    if (name === undefined) {
      return notFound();
    }
    // Start's own answer to a throw is a JSON 500 and a bare log line, so the service catches its
    // own: the throw logged with its request, and the fault in the door's protocol
    try {
      return await DOORS[name](request, env, ctx, url);
    } catch (error) {
      logUnhandled(request, error);
      return name === "rpc" ? rpcFault() : internalError();
    }
  };
