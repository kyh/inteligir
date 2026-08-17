// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// One Hono root splitting /api/v1 (the contract table), GET /ws (the
// invalidation bus), and a fallback — vite middlewares in dev, static client
// + the Start server entry's fetch in prod.

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createNodeWebSocket } from "@hono/node-ws";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { serveStatic } from "@hono/node-server/serve-static";
import type { HttpBindings } from "@hono/node-server";
import type { DbConnection } from "@repo/db/connection";
import { rebindThreadOrigins } from "@repo/db/threads";
import { API_ERROR_STATUS, type ApiErrorResponse } from "@repo/server-contract/errors";
import { API_BASE_PATH, apiRoutes, type AgentStatus } from "@repo/server-contract/routes";
import { WS_PATH } from "@repo/server-contract/notifications";
import { typedRoutes } from "@repo/typed-routes/typed-routes";
import { Hono, type Context, type MiddlewareHandler, type Next } from "hono";
import { browserRequestProblem, buildLocalAppOrigins } from "./browser-request-guard";
import type { AppConfig } from "./config";
import { buildContentSecurityPolicy } from "./csp";
import { CLI_SKILL_MD } from "./guide/cli-skill";
import { proveIdentity } from "./instance-identity";
import type { KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { renameNoteWithLinkRewrite } from "./knowledge/rename";
import { registerKnowledgeRoutes } from "./knowledge/routes";
import { ProposalService } from "./proposals/proposal-service";
import { registerProposalRoutes } from "./proposals/routes";
import { registerThreadRoutes } from "./threads/routes";
import { ThreadService } from "./threads/service";
import type { CreateTurnDriver } from "./threads/turn-driver";
import { registerVaultRoutes } from "./vault/routes";
import type { VaultRuntime } from "./vault/vault-runtime";
import type { WsBus } from "./ws-bus";

/** Thrown by the typed-routes validation wrapper; everything else is a 500. */
class ApiValidationError extends Error {}

type NodeMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

export interface StartFetchOptions {
  context: { nonce: string };
}

export type AppFallback =
  | { kind: "dev"; middlewares: NodeMiddleware }
  | {
      kind: "prod";
      clientDir: string;
      /** The Start server entry's fetch. `context` is the request context Start
       *  threads into the router entry — this app puts the document's nonce
       *  there (src/router.tsx reads it back). */
      startFetch: (request: Request, options: StartFetchOptions) => Promise<Response>;
    }
  /** Tests: no UI behind the API — unmatched paths 404. */
  | { kind: "none" };

export interface CreateAppArgs {
  /** What the boot-time driver resolution decided; served on /system/status. */
  agent: AgentStatus;
  bus: WsBus;
  config: AppConfig;
  /** The provider seam (agent-driver.ts resolves which driver boots). */
  createTurnDriver: CreateTurnDriver;
  /** The thread routes' store; system/status reads nothing from it (schemaVersion below). */
  db: DbConnection;
  fallback: AppFallback;
  /** This boot's secret (instance-identity.ts). Answers the identity challenge
   *  a client uses to tell this server from anything else holding the port. */
  instanceSecret: string;
  knowledge: KnowledgeRuntime;
  /** Resolved once at boot, after migrate — not a SELECT per status request. */
  schemaVersion: number;
  startedAt: number;
  vault: VaultRuntime;
  version: string;
}

const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_NO_STORE_CACHE_CONTROL = "no-store";

/** Marks a request `serveStatic` answered, so the cache-control wrapper can
 * tell a served file from the document render behind it. */
type AppEnv = { Bindings: HttpBindings; Variables: { staticFilePath?: string } };

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

export function createApp(args: CreateAppArgs) {
  const app = new Hono<AppEnv>();
  const nodeWebSocket = createNodeWebSocket({ app });
  const upgradeWebSocket = nodeWebSocket.upgradeWebSocket.bind(nodeWebSocket);
  const injectWebSocket = nodeWebSocket.injectWebSocket.bind(nodeWebSocket);

  const allowedOrigins = buildLocalAppOrigins(args.config.port);
  const guardBrowserRequest = async (c: Context, next: Next) => {
    const problem = browserRequestProblem(
      {
        host: c.req.header("host"),
        origin: c.req.header("origin"),
        secFetchSite: c.req.header("sec-fetch-site"),
      },
      allowedOrigins,
    );
    if (problem !== null) {
      const body: ApiErrorResponse = {
        error: "forbidden_origin",
        message: problem,
      };
      return c.json(body, API_ERROR_STATUS.forbidden_origin);
    }
    await next();
    return undefined;
  };

  const api = new Hono();
  api.use("*", guardBrowserRequest);
  api.onError((error, context) => {
    if (error instanceof ApiValidationError) {
      const body: ApiErrorResponse = {
        error: "invalid_request",
        message: error.message,
      };
      return context.json(body, API_ERROR_STATUS.invalid_request);
    }
    // Never echo internals: the full error goes to the server log only.
    console.error(`api error on ${context.req.method} ${context.req.path}`, error);
    const body: ApiErrorResponse = {
      error: "internal",
      message: "Internal server error",
    };
    return context.json(body, API_ERROR_STATUS.internal);
  });
  const registrars = typedRoutes(api, {
    onValidationError: (message) => new ApiValidationError(message),
  });
  const { get, post } = registrars;

  get(apiRoutes.health, (c) => c.json({ ok: true }));
  get(apiRoutes.system.status, (c) =>
    c.json({
      version: args.version,
      dataDir: args.config.dataDir,
      vaultDir: args.config.vaultDir,
      schemaVersion: args.schemaVersion,
      uptimeMs: Date.now() - args.startedAt,
      agent: args.agent,
    }),
  );
  // Answers a caller's nonce with an HMAC keyed by this boot's secret, so a
  // client can tell THIS server from anything else that reached the port
  // first. Deliberately unauthenticated and unthrottled: the answer is worth
  // nothing without the secret, and refusing to answer would only stop the
  // legitimate client. The secret itself never leaves the process.
  get(apiRoutes.system.identity, (c, query) =>
    c.json({
      proof: proveIdentity(args.instanceSecret, query.challenge),
      dataDir: args.config.dataDir,
    }),
  );
  get(apiRoutes.guide, (c) => c.json({ markdown: CLI_SKILL_MD }));
  registerVaultRoutes(registrars, args.vault, (from, to) =>
    renameNoteWithLinkRewrite({
      service: args.vault.service,
      knowledge: args.knowledge,
      rebindThreads: (movedFrom, movedTo) =>
        rebindThreadOrigins(args.db, args.bus, { from: movedFrom, to: movedTo }),
      from,
      to,
    }),
  );
  registerKnowledgeRoutes(registrars, args.knowledge);

  registerProposalRoutes({
    routes: { get, post },
    service: new ProposalService({
      db: args.db,
      notifier: args.bus,
      vault: args.vault.service,
    }),
  });

  registerThreadRoutes({
    routes: { get, post },
    service: new ThreadService({
      db: args.db,
      notifier: args.bus,
      createTurnDriver: args.createTurnDriver,
    }),
  });

  // Unmatched API paths answer JSON here — an API caller must never receive
  // the SPA shell or a Vite page from the fallthrough below.
  api.all("*", (c) => {
    const body: ApiErrorResponse = { error: "not_found", message: "Not found" };
    return c.json(body, API_ERROR_STATUS.not_found);
  });

  app.route(API_BASE_PATH, api);

  app.get(
    WS_PATH,
    guardBrowserRequest,
    upgradeWebSocket(() => ({
      onOpen: (_event, socket) => args.bus.registerClient(socket),
      onMessage: (event, socket) => args.bus.handleMessage(socket, event.data),
      onClose: (_event, socket) => args.bus.unregisterClient(socket),
    })),
  );

  const fallback = args.fallback;
  if (fallback.kind === "dev") {
    app.all("*", (c) => {
      const { incoming, outgoing } = c.env;
      fallback.middlewares(incoming, outgoing, (err?: unknown) => {
        if (err !== undefined && err !== null) {
          console.error("vite middleware error", err);
          if (!outgoing.headersSent) {
            outgoing.statusCode = 500;
          }
          outgoing.end();
          return;
        }
        if (!outgoing.headersSent) {
          outgoing.statusCode = 404;
          outgoing.end("Not found");
        }
      });
      return RESPONSE_ALREADY_SENT;
    });
  }

  if (fallback.kind === "prod") {
    const clientDir = resolve(fallback.clientDir);
    const wsOrigin = `ws://127.0.0.1:${args.config.port}`;
    const serveClientFile = serveStatic<AppEnv>({
      root: clientDir,
      onFound: (path, c) => {
        c.set("staticFilePath", path);
      },
    });
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

    // ONE answer per URL, and it is the Start entry's, never a prerendered
    // file. A build-time shell is stale by construction — its head is rendered
    // against the whole manifest while its dehydrated payload names only
    // __root__, and being a file it can carry no per-request nonce. The entry
    // answers the URL that was actually asked for, so what the client hydrates
    // is what the client is about to render, and Start threads the nonce
    // through its own renderer. `ssr: false` on the workspace route
    // (src/routes/index.tsx) is what keeps that answer a SHELL rather than an
    // SSR of a browser-only tree.
    const renderDocument = async (request: Request): Promise<Response> => {
      const nonce = randomBytes(16).toString("base64");
      const response = await fallback.startFetch(request, { context: { nonce } });
      // Rebuilt rather than mutated: a Response the entry streams may carry
      // immutable headers, and a header set that silently no-ops would ship a
      // document with no policy on it.
      const headers = new Headers(response.headers);
      headers.set("cache-control", STATIC_NO_STORE_CACHE_CONTROL);
      // The document is the only response that can execute anything, so it is
      // the only one that carries the policy.
      headers.set("content-security-policy", buildContentSecurityPolicy({ nonce, wsOrigin }));
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "no-referrer");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };

    app.on(
      ["GET", "HEAD"],
      "*",
      staticCacheControl(STATIC_NO_STORE_CACHE_CONTROL),
      serveClientFile,
      (c): Promise<Response> => renderDocument(c.req.raw),
    );

    app.all("*", (c) => renderDocument(c.req.raw));
  }

  return { app, injectWebSocket };
}
