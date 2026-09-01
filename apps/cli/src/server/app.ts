// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// ROUTE WIRING over an injected context — compose.ts is the composition root
// that builds it. One Hono root splitting /rpc (the oRPC handler), the four
// routes that are deliberately not procedures (`@repo/api/local/routes` says
// why), the two browser landings, and — when this install ships one — the
// built workspace UI as static files. Everything but /health and the landings
// is behind the device token (server-file.ts).

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
import type { AppServices } from "./compose";
import { handleConnectorOauthCallback } from "./connectors/oauth-callback";
import { documentSecurityHeaders } from "./csp";
import { ERROR_STATUS_MAP, errorStatus } from "./error-status";
import { loopbackRequestOrigin } from "./loopback-origin";
import { localRouter } from "./root-router";
import { presentedCredential, serverTokenCookie, tokenAccepted } from "./server-file";
import { handleVaultAsset } from "./vault/asset-route";
import type { VoiceStreamConnection, VoiceStreamHub } from "./voice/voice-stream-hub";
import type { WsBus } from "./ws-bus";

export interface CreateAppArgs {
  /** Everything a handler reaches, built once by the composition root. */
  context: AppServices;
  /** The invalidation bus `/ws` subscribes clients to. */
  bus: WsBus;
  /** The dictation hub `/voice/stream` opens connections on; it tracks every
   *  one so the listener teardown can close them by name. */
  voiceStreamHub: VoiceStreamHub;
  /** This boot's bearer (server-file.ts). Every privileged surface requires
   *  it; the data dir it was written into is what makes holding it meaningful. */
  serverToken: string;
  /** The workspace UI this server answers, or null when it has none. The
   *  bundle is the DESKTOP renderer's build, staged beside this program so
   *  `inteligir serve --open` lands a browser in the product; null is a
   *  checkout that has not built one, and every route suite. */
  clientDir: string | null;
  /** The CONFIGURED port — only the document policy's fallback for a request
   *  naming no loopback Host; the bound port comes from the request itself. */
  configuredPort: number;
}

const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_NO_STORE_CACHE_CONTROL = "no-store";

/** Marks a request `serveStatic` answered, so the cache-control wrapper can
 * tell a served file from the shell behind it. */
type AppEnv = { Variables: { staticFilePath?: string } };

// Set after the chain answers: serveStatic's own onFound header writes land
// after it has already built its Response, so they never reach the wire — the
// wrapper stamps the finalized response instead.
const staticCacheControl =
  (cacheControl: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    await next();
    if (c.get("staticFilePath") !== undefined) {
      c.res.headers.set("cache-control", cacheControl);
    }
  };

/** Below this, a refusal is normal control flow rather than a server fault: a
 *  missing row, a rejected input, a conflict a client is expected to merge.
 *  Logging those would be noise, and the log is the only place internals may
 *  appear at all. */
const SERVER_FAULT_STATUS = 500;

export function createApp(args: CreateAppArgs) {
  const app = new Hono<AppEnv>();
  const nodeWebSocket = createNodeWebSocket({ app });
  const upgradeWebSocket = nodeWebSocket.upgradeWebSocket.bind(nodeWebSocket);
  const injectWebSocket = nodeWebSocket.injectWebSocket.bind(nodeWebSocket);

  // THE ONE GATE, and it sits at the HTTP boundary rather than in a procedure
  // middleware because three of the four surfaces it protects are not
  // procedures: the invalidation bus, the dictation stream and the vault's
  // asset bytes. A gate per transport is a gate that can disagree with itself.
  //
  // `/health` is deliberately outside it — a supervisor's spawn probe must
  // answer before it has any reason to hold a credential, and `{ok:true}`
  // discloses nothing a bound port does not.
  //
  // The two browser landings (`/pair/callback`, the connector OAuth callback)
  // are outside it too, and cannot be inside it: what arrives is a cross-site
  // top-level navigation carrying no credential by construction. Their
  // single-use `state` stands in its place, which is the whole argument
  // `cloud/pair-callback.ts` states.
  //
  // A COOKIE-authed request gets a SECOND check the bearer path does not: the
  // cookie is ambient (the browser attaches it to same-site requests, and
  // loopback "site" ignores the port), so a co-resident page on another
  // 127.0.0.1 port carries it — the one gap `SameSite=Strict` leaves open. It
  // must therefore prove it is same-ORIGIN (`browser-request.ts`). The bearer
  // is not ambient, so it is trusted as-is.
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
    // oRPC v2 carries no status on the error; the handler maps code → status
    // here. Custom codes (INVALID_PATH, ALREADY_EXISTS, …) plus oRPC's built-ins,
    // in one place also read by the asset route (error-status.ts).
    errorStatusMap: ERROR_STATUS_MAP,
    interceptors: [
      onError((cause: unknown) => {
        // Never echo internals: the full error goes to the server log only,
        // and only for the classes that are genuinely faults. Below 500 is
        // normal control flow — a missing row, a rejected input, a conflict the
        // client is expected to merge — and the status now comes from the map.
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

  // Beside `/ws`, behind the SAME gate, but its OWN endpoint: a dictation
  // socket carries PCM16 frames UP and `partial`/`final`/`error` messages DOWN
  // (issue #578) — a PAYLOAD, which the invalidation bus carries none of by
  // decision. The hub tracks every connection so the listener teardown can
  // close them by name.
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

  // Beside the upgrades above and for the mirror-image reason: those are not
  // procedures because a websocket is not a request/response pair, and this one
  // is not because what arrives is a BROWSER expecting a page. It carries no
  // token either — the redirect that reaches it IS a cross-site top-level
  // navigation, which cannot carry one — and the single-use `state` the runtime
  // is holding stands in its place. `cloud/pair-callback.ts` states the whole
  // argument.
  app.get(PAIR_CALLBACK_PATH, async (c) => {
    const answer = await handlePairCallback(args.context.cloud, new URL(c.req.url));
    return c.body(answer.body, answer.status, answer.headers);
  });

  // The connectors' own browser landing (issue #602) — same argument, same
  // shape, a different provider on the far side (`connectors/oauth-callback.ts`).
  app.get(CONNECTOR_OAUTH_CALLBACK_PATH, async (c) => {
    const answer = await handleConnectorOauthCallback(
      args.context.connectorsOauth,
      new URL(c.req.url),
    );
    return c.body(answer.body, answer.status, answer.headers);
  });

  if (args.clientDir !== null) {
    const clientDir = resolve(args.clientDir);
    /** The document's policy names the socket origin the CALLER reached, taken
     *  from its own Host header rather than the configured port — a dev port
     *  may have been probed upward at bind, and `connect-src` naming the value
     *  that was asked for rather than the one that answered is a policy that
     *  refuses this app's own invalidation socket. Falls back to the configured
     *  port for a request that names no loopback host. */
    // Read ONCE: the bundle is staged at build time and immutable for this
    // process's life, so re-reading it is a disk hit per deep link.
    const shellDocument = readFileSync(join(clientDir, "index.html"), "utf8");
    const configuredOrigin = `http://127.0.0.1:${String(args.configuredPort)}`;
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

    /**
     * The document's own headers, stamped by CONTENT TYPE rather than by
     * route, because two producers answer one: `serveStatic` hands back
     * `index.html` for `/` itself, and the fallback below reads the same file
     * for every deep link the router owns. A rule per producer is two rules
     * that can disagree about the policy on the same bytes.
     *
     * This is also where the browser gets its credential: it is the one client
     * that cannot set a header for itself (server-file.ts says why), and the
     * document is the one response it is guaranteed to receive first.
     */
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

    // Only /assets/* carries content hashes, so only it may be immutable —
    // and an asset miss must 404: answering it with the shell hands the
    // module loader HTML and produces an opaque MIME error instead.
    app.on(
      ["GET", "HEAD"],
      "/assets/*",
      staticCacheControl(STATIC_ASSET_CACHE_CONTROL),
      serveClientFile,
      (c) => c.text("Not found", 404),
    );

    // ONE answer per URL and it is a FILE: the router reads the URL
    // client-side, so every deep link is the same document.
    app.on(
      ["GET", "HEAD"],
      "*",
      documentHeaders,
      staticCacheControl(STATIC_NO_STORE_CACHE_CONTROL),
      serveClientFile,
      (c) => c.html(shellDocument),
    );
  }

  // Last, so nothing dials the cloud until the surfaces it will announce
  // invalidations through are mounted.
  args.context.cloud.start();

  return { app, injectWebSocket };
}
