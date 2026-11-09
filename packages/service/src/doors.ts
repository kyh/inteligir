// Each door a Start server route hands its request to (apps/web/src/routes), bound to this request's
// bindings and the ExecutionContext Cloudflare handed the entry: the connector's OAuth provider
// writes `ctx.props` and `ctx.auth` on that very object and the connector reads them back, so the
// doors are built per request, never kept.

import { createAuth, withoutAuthToken } from "./auth/auth";
import { handleInviteSignUp } from "./auth/invite";
import { connectorAuth } from "./connector/connector-auth";
import { handleConnector } from "./connector/connector-route";
import { handleConsent } from "./connector/consent-route";
import { doorAt } from "./door-routes";
import type { Door, DoorName, Doors } from "./doors-api";
import { handleBlobRoute } from "./library/blob-routes";
import { handleLibrarySocket } from "./library/socket-routes";
import { logUnhandled } from "./log";
import { rpcFault } from "./wire/rpc-refusal";
import { handleV1Rpc } from "./wire/v1-rpc";

const notFound = (): Response => new Response("not found", { status: 404 });

const internalError = (): Response => new Response("internal error", { status: 500 });

// Start's own answer to a throw is a JSON 500 and a bare log line, so a door catches its own: the
// throw logged with its request, and the fault in the door's protocol. Every door answers its own
// methods, and its path only as the table spells it: Start's splat route takes its prefix bare too
const door =
  (name: DoorName, answer: Door, fault: () => Response = internalError): Door =>
  async (request) => {
    if (doorAt(new URL(request.url).pathname) !== name) {
      return notFound();
    }
    try {
      return await answer(request);
    } catch (error) {
      logUnhandled(request, error);
      return fault();
    }
  };

export const doorsFor = (env: Env, ctx: ExecutionContext): Doors => {
  // an assistant's door, which names no build and takes no session: the token the provider's
  // endpoints minted, asked for on the consent page
  const connector: Door = async (request) => await handleConnector(request, env, ctx);
  const authorizationServer: Door = async (request) =>
    await connectorAuth(env).authorizationServer.fetch(request, env, ctx);
  return {
    auth: door("auth", async (request) =>
      withoutAuthToken(await createAuth(env, ctx, new URL(request.url).origin).handler(request)),
    ),
    // the site's sign-up form, which its own page posts and which ships in the same deploy
    signUp: door("signUp", async (request) =>
      request.method === "POST" ? await handleInviteSignUp(request, env, ctx) : notFound(),
    ),
    // the one wire: its own floor, credential and refusals, all in its protocol
    rpc: door(
      "rpc",
      async (request) => await handleV1Rpc(request, env, ctx, new URL(request.url)),
      rpcFault,
    ),
    // the library's files: the floor and the session checked as the wire checks them
    blobs: door(
      "blobs",
      async (request) => await handleBlobRoute(request, env, ctx, new URL(request.url)),
    ),
    // a browser's socket cannot name its build, and its ticket came from a call that met the floor
    socket: door(
      "socket",
      async (request) => await handleLibrarySocket(request, env, ctx, new URL(request.url)),
    ),
    connector: door("connector", connector),
    connectorMetadata: door("connectorMetadata", connector),
    authorizationServerMetadata: door("authorizationServerMetadata", authorizationServer),
    oauthToken: door("oauthToken", authorizationServer),
    oauthRegister: door("oauthRegister", authorizationServer),
    consent: door("consent", async (request) => await handleConsent(request, env, ctx)),
  };
};
