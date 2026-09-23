// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  BROWSER_HANDOFF_PARAM,
  HEALTH_PATH,
  RPC_PREFIX,
  VAULT_ASSET_PATH,
  VOICE_STREAM_PATH,
  websocketOrigin,
  WS_PATH,
} from "@repo/api/local/routes";
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { CONNECTOR_OAUTH_CALLBACK_PATH } from "@repo/api/local/connectors/connectors-schema";
import { isSameOriginBrowserRequest } from "./browser-request";
import { handleConnectorOauthCallback } from "./connectors/oauth-callback";
import { documentSecurityHeaders } from "./csp";
import { ERROR_STATUS_MAP, errorStatus } from "./error-status";
import { loopbackRequestOrigin } from "./loopback-origin";
import type { AppServices } from "./orpc";
import { localRouter } from "./root-router";
import { presentedCredential, tokenAccepted } from "./server-file";
import type { PresentedCredential } from "./server-file";
import { handleVaultAsset } from "./vault/asset-route";
import type { VoiceStreamConnection } from "./voice/voice-stream-connection";
import type { VoiceStreamHub } from "./voice/voice-stream-hub";
import type { WsBus } from "./ws-bus";

export interface CreateAppArgs {
  context: AppServices;
  bus: WsBus;
  voiceStreamHub: VoiceStreamHub;
  serverToken: string;
  clientDir: string | null;
}

const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_NO_STORE_CACHE_CONTROL = "no-store";

interface AppEnv {
  // set by the host guard before any route runs: the bound port comes from the request, since a
  // dev port may have been probed upward at bind.
  Variables: { staticFilePath?: string; requestOrigin: string };
}

// stamped after the chain answers: serveStatic's onFound header writes land after its
// Response is built and never reach the wire.
const staticCacheControl =
  (cacheControl: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    // oxlint-disable-next-line node/callback-return -- hono's next() resolves after the downstream handlers; the header is stamped on their response
    await next();
    if (c.get("staticFilePath") !== undefined) {
      c.res.headers.set("cache-control", cacheControl);
    }
  };

// below this a refusal is control flow, not a fault; the log is the only place internals may appear.
const SERVER_FAULT_STATUS = 500;

const isOrpcError = (cause: unknown): cause is ORPCError<string, unknown> =>
  cause instanceof ORPCError;

export const createApp = (args: CreateAppArgs) => {
  const app = new Hono<AppEnv>();
  const nodeWebSocket = createNodeWebSocket({ app });
  const upgradeWebSocket = nodeWebSocket.upgradeWebSocket.bind(nodeWebSocket);
  const injectWebSocket = nodeWebSocket.injectWebSocket.bind(nodeWebSocket);

  // first, ahead of every route, /health and the oauth landing included: the server binds 127.0.0.1
  // alone, so any other name is a page that rebound its own hostname onto this port. the header,
  // never the url: an upgrade's url is rebuilt on a fixed localhost base.
  app.use("*", async (c, next): Promise<Response | undefined> => {
    const origin = loopbackRequestOrigin(c.req.header("host"));
    if (origin === null) {
      return c.text("This server answers only to 127.0.0.1 and localhost", 421);
    }
    c.set("requestOrigin", origin);
    // oxlint-disable-next-line node/callback-return -- hono's `next` continues the chain and answers nothing; a middleware returns a Response only to short-circuit
    await next();
    return undefined;
  });

  // each carrier has its own secret: the bearer never rides a cookie, and the browser's cookie is no bearer.
  const credentialAccepted = (credential: PresentedCredential): boolean =>
    credential.carrier === "header"
      ? tokenAccepted(args.serverToken, credential.token)
      : args.context.browserSession.cookieAccepted(credential.token);

  // one gate at the http boundary: three of the four surfaces it protects are not procedures.
  // /health stays outside (a supervisor's spawn probe holds no credential yet), and so does the
  // oauth browser landing (a cross-site top-level navigation carries none; its single-use state
  // stands in). a cookie is ambient and loopback "site" ignores the port, so a co-resident page
  // on another 127.0.0.1 port carries it: a cookie-authed request must also prove same-origin.
  const requireServerToken: MiddlewareHandler = async (c, next): Promise<Response | undefined> => {
    const credential = presentedCredential({
      authorization: c.req.header("authorization"),
      cookie: c.req.header("cookie"),
    });
    if (credential === null || !credentialAccepted(credential)) {
      return c.text("This request carried no valid inteligir device token", 401);
    }
    if (
      credential.carrier === "cookie" &&
      !isSameOriginBrowserRequest({
        host: c.req.header("host"),
        origin: c.req.header("origin"),
        secFetchSite: c.req.header("sec-fetch-site"),
      })
    ) {
      return c.text("This cross-origin request cannot use the session cookie", 403);
    }
    // oxlint-disable-next-line node/callback-return -- hono's `next` continues the chain and answers nothing; a middleware returns a Response only to short-circuit
    await next();
    return undefined;
  };

  const rpc = new RPCHandler(localRouter, {
    errorStatusMap: ERROR_STATUS_MAP,
    interceptors: [
      onError((cause: unknown) => {
        if (isOrpcError(cause) && errorStatus(cause.code) < SERVER_FAULT_STATUS) {
          return;
        }
        console.error("rpc error", cause);
      }),
    ],
  });

  app.use(`${RPC_PREFIX}/*`, requireServerToken);
  app.all(`${RPC_PREFIX}/*`, async (c) => {
    const { response } = await rpc.handle(c.req.raw, {
      context: { ...args.context, requestHost: c.req.header("host") },
      prefix: RPC_PREFIX,
    });
    return response ?? c.text("Not found", 404);
  });

  app.get(HEALTH_PATH, (c) => c.json({ ok: true } as const));

  app.get(
    VAULT_ASSET_PATH,
    requireServerToken,
    async (c) => await handleVaultAsset(c, args.context.vault.service),
  );

  app.get(
    WS_PATH,
    requireServerToken,
    upgradeWebSocket(() => ({
      onClose: (_event, socket) => {
        args.bus.unregisterClient(socket);
      },
      onMessage: (event, socket) => {
        args.bus.handleMessage(socket, event.data);
      },
      onOpen: (_event, socket) => {
        args.bus.registerClient(socket);
      },
    })),
  );

  // its own endpoint: it carries a payload (pcm16 up, partial/final down), which the invalidation bus never does.
  app.get(
    VOICE_STREAM_PATH,
    requireServerToken,
    upgradeWebSocket(() => {
      let connection: VoiceStreamConnection | null = null;
      return {
        onClose: () => {
          void connection?.dispose();
          connection = null;
        },
        onMessage: (event) => {
          connection?.receive(event.data);
        },
        onOpen: (_event, socket) => {
          connection = args.voiceStreamHub.open(socket);
        },
      };
    }),
  );

  // no token: the redirect is a cross-site top-level navigation, which cannot carry one.
  app.get(CONNECTOR_OAUTH_CALLBACK_PATH, async (c) => {
    const answer = await handleConnectorOauthCallback(
      args.context.connectorsOauth,
      new URL(c.req.url),
    );
    return c.body(answer.body, answer.status, answer.headers);
  });

  if (args.clientDir !== null) {
    const clientDir = nodePath.resolve(args.clientDir);
    // read once: the bundle is immutable for this process's life.
    const shellDocument = readFileSync(nodePath.join(clientDir, "index.html"), "utf-8");
    const serveClientFile = serveStatic<AppEnv>({
      onFound: (path, c) => {
        c.set("staticFilePath", path);
      },
      root: clientDir,
    });

    // a browser's one way in. live or spent, the answer is the same URL without the nonce, so it
    // never lingers in the address bar or the history and a reload lands a browser that already
    // holds its cookie. the origin is the guard's: a path of `//elsewhere/` must stay on this server.
    const browserHandoff: MiddlewareHandler<AppEnv> = async (
      c,
      next,
    ): Promise<Response | undefined> => {
      const nonce = c.req.query(BROWSER_HANDOFF_PARAM);
      if (nonce === undefined) {
        // oxlint-disable-next-line node/callback-return -- hono's `next` continues the chain and answers nothing; a middleware returns a Response only to short-circuit
        await next();
        return undefined;
      }
      const target = new URL(c.req.url);
      target.searchParams.delete(BROWSER_HANDOFF_PARAM);
      const cookie = args.context.browserSession.redeemHandoff(nonce);
      c.header("cache-control", STATIC_NO_STORE_CACHE_CONTROL);
      if (cookie !== null) {
        c.header("set-cookie", cookie);
      }
      return c.redirect(`${c.get("requestOrigin")}${target.pathname}${target.search}`, 303);
    };

    // stamped by content type, not route: serveStatic answers index.html for `/` and the fallback
    // reads the same file for deep links. the ws origin is the one the caller reached: a
    // connect-src naming the configured port refuses this app's own socket on a probed dev bind.
    const documentHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
      // oxlint-disable-next-line node/callback-return -- hono's next() resolves after the downstream handlers; the headers are stamped on their response
      await next();
      if (!(c.res.headers.get("content-type") ?? "").includes("text/html")) {
        return;
      }
      c.res.headers.set("cache-control", STATIC_NO_STORE_CACHE_CONTROL);
      const policy = documentSecurityHeaders({
        wsOrigin: websocketOrigin(c.get("requestOrigin")),
      });
      for (const [name, value] of Object.entries(policy)) {
        c.res.headers.set(name, value);
      }
    };

    // only /assets/* carries content hashes, so only it may be immutable; an asset miss must 404,
    // since answering with the shell hands the module loader html and an opaque mime error.
    app.on(
      ["GET", "HEAD"],
      "/assets/*",
      staticCacheControl(STATIC_ASSET_CACHE_CONTROL),
      serveClientFile,
      (c) => c.text("Not found", 404),
    );

    app.on(
      ["GET", "HEAD"],
      "*",
      browserHandoff,
      documentHeaders,
      staticCacheControl(STATIC_NO_STORE_CACHE_CONTROL),
      serveClientFile,
      (c) => c.html(shellDocument),
    );
  }

  return { app, injectWebSocket };
};
