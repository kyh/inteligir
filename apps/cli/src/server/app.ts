// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  HEALTH_PATH,
  RPC_PREFIX,
  VAULT_ASSET_PATH,
  VOICE_STREAM_PATH,
  websocketOrigin,
  WS_PATH,
} from "@repo/api/local/routes";
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono, type Context, type MiddlewareHandler, type Next } from "hono";
import { PAIR_CALLBACK_PATH } from "@repo/api/cloud/pairing/pairing-schema";
import { CONNECTOR_OAUTH_CALLBACK_PATH } from "@repo/api/local/connectors/connectors-schema";
import { isSameOriginBrowserRequest } from "./browser-request";
import { handlePairCallback } from "./cloud/pair-callback";
import { handleConnectorOauthCallback } from "./connectors/oauth-callback";
import { documentSecurityHeaders } from "./csp";
import { ERROR_STATUS_MAP, errorStatus } from "./error-status";
import { loopbackRequestOrigin } from "./loopback-origin";
import type { AppServices } from "./orpc";
import { localRouter } from "./root-router";
import { presentedCredential, serverTokenCookie, tokenAccepted } from "./server-file";
import { handleVaultAsset } from "./vault/asset-route";
import type { VoiceStreamConnection, VoiceStreamHub } from "./voice/voice-stream-hub";
import type { WsBus } from "./ws-bus";

export interface CreateAppArgs {
  context: AppServices;
  bus: WsBus;
  voiceStreamHub: VoiceStreamHub;
  serverToken: string;
  clientDir: string | null;
  // only the document policy's fallback for a request naming no loopback host; the bound port comes from the request.
  configuredPort: number;
}

const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_NO_STORE_CACHE_CONTROL = "no-store";

type AppEnv = { Variables: { staticFilePath?: string } };

// stamped after the chain answers: serveStatic's onFound header writes land after its
// Response is built and never reach the wire.
const staticCacheControl =
  (cacheControl: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    await next();
    if (c.get("staticFilePath") !== undefined) {
      c.res.headers.set("cache-control", cacheControl);
    }
  };

// below this a refusal is control flow, not a fault; the log is the only place internals may appear.
const SERVER_FAULT_STATUS = 500;

export function createApp(args: CreateAppArgs) {
  const app = new Hono<AppEnv>();
  const nodeWebSocket = createNodeWebSocket({ app });
  const upgradeWebSocket = nodeWebSocket.upgradeWebSocket.bind(nodeWebSocket);
  const injectWebSocket = nodeWebSocket.injectWebSocket.bind(nodeWebSocket);

  // one gate at the http boundary: three of the four surfaces it protects are not procedures.
  // /health stays outside (a supervisor's spawn probe holds no credential yet), and so do the two
  // browser landings (a cross-site top-level navigation carries none; their single-use state
  // stands in). a cookie is ambient and loopback "site" ignores the port, so a co-resident page
  // on another 127.0.0.1 port carries it: a cookie-authed request must also prove same-origin.
  const requireServerToken = async (c: Context, next: Next) => {
    const credential = presentedCredential({
      authorization: c.req.header("authorization"),
      cookie: c.req.header("cookie"),
    });
    if (credential === null || !tokenAccepted(args.serverToken, credential.token)) {
      return c.text("This request carried no valid inteligir device token", 401);
    }
    if (
      credential.carrier === "cookie" &&
      !isSameOriginBrowserRequest({
        secFetchSite: c.req.header("sec-fetch-site"),
        origin: c.req.header("origin"),
        host: c.req.header("host"),
      })
    ) {
      return c.text("This cross-origin request cannot use the session cookie", 403);
    }
    await next();
    return undefined;
  };

  const rpc = new RPCHandler(localRouter, {
    errorStatusMap: ERROR_STATUS_MAP,
    interceptors: [
      onError((cause: unknown) => {
        if (cause instanceof ORPCError && errorStatus(cause.code) < SERVER_FAULT_STATUS) {
          return;
        }
        console.error("rpc error", cause);
      }),
    ],
  });

  app.use(`${RPC_PREFIX}/*`, requireServerToken);
  app.all(`${RPC_PREFIX}/*`, async (c) => {
    const { response } = await rpc.handle(c.req.raw, {
      prefix: RPC_PREFIX,
      context: { ...args.context, requestHost: c.req.header("host") },
    });
    return response ?? c.text("Not found", 404);
  });

  app.get(HEALTH_PATH, (c) => c.json({ ok: true } as const));

  app.get(VAULT_ASSET_PATH, requireServerToken, (c) =>
    handleVaultAsset(c, args.context.vault.service),
  );

  app.get(
    WS_PATH,
    requireServerToken,
    upgradeWebSocket(() => ({
      onOpen: (_event, socket) => args.bus.registerClient(socket),
      onMessage: (event, socket) => args.bus.handleMessage(socket, event.data),
      onClose: (_event, socket) => args.bus.unregisterClient(socket),
    })),
  );

  // its own endpoint: it carries a payload (pcm16 up, partial/final down), which the invalidation bus never does.
  app.get(
    VOICE_STREAM_PATH,
    requireServerToken,
    upgradeWebSocket(() => {
      let connection: VoiceStreamConnection | null = null;
      return {
        onOpen: (_event, socket) => {
          connection = args.voiceStreamHub.open(socket);
        },
        onMessage: (event) => {
          connection?.receive(event.data);
        },
        onClose: () => {
          void connection?.dispose();
          connection = null;
        },
      };
    }),
  );

  // no token: the redirect is a cross-site top-level navigation, which cannot carry one.
  app.get(PAIR_CALLBACK_PATH, async (c) => {
    const answer = await handlePairCallback(args.context.cloud, new URL(c.req.url));
    return c.body(answer.body, answer.status, answer.headers);
  });

  app.get(CONNECTOR_OAUTH_CALLBACK_PATH, async (c) => {
    const answer = await handleConnectorOauthCallback(
      args.context.connectorsOauth,
      new URL(c.req.url),
    );
    return c.body(answer.body, answer.status, answer.headers);
  });

  if (args.clientDir !== null) {
    const clientDir = resolve(args.clientDir);
    // read once: the bundle is immutable for this process's life.
    const shellDocument = readFileSync(join(clientDir, "index.html"), "utf8");
    const configuredOrigin = `http://127.0.0.1:${String(args.configuredPort)}`;
    // the ws origin comes from the caller's own host header: a dev port may have been probed
    // upward at bind, and a connect-src naming the configured port refuses this app's own socket.
    const documentHeadersFor = (host: string | undefined): Record<string, string> =>
      documentSecurityHeaders({
        wsOrigin: websocketOrigin(loopbackRequestOrigin(host) ?? configuredOrigin),
      });
    const serveClientFile = serveStatic<AppEnv>({
      root: clientDir,
      onFound: (path, c) => {
        c.set("staticFilePath", path);
      },
    });

    // stamped by content type, not route: serveStatic answers index.html for `/` and the fallback
    // reads the same file for deep links. also where the browser gets its cookie: it cannot set a header.
    const documentHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
      await next();
      if (!(c.res.headers.get("content-type") ?? "").includes("text/html")) {
        return;
      }
      c.res.headers.set("cache-control", STATIC_NO_STORE_CACHE_CONTROL);
      for (const [name, value] of Object.entries(documentHeadersFor(c.req.header("host")))) {
        c.res.headers.set(name, value);
      }
      c.res.headers.set("set-cookie", serverTokenCookie(args.serverToken));
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
      documentHeaders,
      staticCacheControl(STATIC_NO_STORE_CACHE_CONTROL),
      serveClientFile,
      (c) => c.html(shellDocument),
    );
  }

  return { app, injectWebSocket };
}
