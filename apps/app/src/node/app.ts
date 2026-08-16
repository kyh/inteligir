// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// One Hono root splitting /api/v1 (the contract table), GET /ws (the
// invalidation bus), and a fallback — vite middlewares in dev, static client
// + the Start server entry's fetch in prod.

import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { createNodeWebSocket } from "@hono/node-ws";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { serveStatic } from "@hono/node-server/serve-static";
import type { HttpBindings } from "@hono/node-server";
import type { DbConnection } from "@repo/db/connection";
import {
  API_BASE_PATH,
  apiRoutes,
  type AgentStatus,
  type ApiErrorResponse,
} from "@repo/server-contract/routes";
import { WS_PATH } from "@repo/server-contract/notifications";
import { typedRoutes } from "@repo/typed-routes/typed-routes";
import { Hono, type Context, type MiddlewareHandler, type Next } from "hono";
import { browserRequestProblem, buildLocalAppOrigins } from "./browser-request-guard";
import type { AppConfig } from "./config";
import { CLI_SKILL_MD } from "./guide/cli-skill";
import type { KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { renameNoteWithLinkRewrite } from "./knowledge/rename";
import { registerKnowledgeRoutes } from "./knowledge/routes";
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

export type AppFallback =
  | { kind: "dev"; middlewares: NodeMiddleware }
  | {
      kind: "prod";
      clientDir: string;
      startFetch: (request: Request) => Promise<Response>;
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
  knowledge: KnowledgeRuntime;
  /** Resolved once at boot, after migrate — not a SELECT per status request. */
  schemaVersion: number;
  startedAt: number;
  vault: VaultRuntime;
  version: string;
}

const SPA_SHELL_FILE_NAME = "_shell.html";
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_NO_STORE_CACHE_CONTROL = "no-store";

/** Marks a request `serveStatic` answered, so the cache-control wrapper can
 * tell a served file from the shell / Start fallthrough behind it. */
type AppEnv = { Bindings: HttpBindings; Variables: { staticFilePath?: string } };

function acceptsHtml(acceptHeader: string | undefined): boolean {
  return acceptHeader !== undefined && acceptHeader.includes("text/html");
}

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
      { host: c.req.header("host"), origin: c.req.header("origin") },
      allowedOrigins,
    );
    if (problem !== null) {
      const body: ApiErrorResponse = {
        error: "forbidden_origin",
        message: problem,
      };
      return c.json(body, 403);
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
      return context.json(body, 400);
    }
    // Never echo internals: the full error goes to the server log only.
    console.error(`api error on ${context.req.method} ${context.req.path}`, error);
    const body: ApiErrorResponse = {
      error: "internal",
      message: "Internal server error",
    };
    return context.json(body, 500);
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
      schemaVersion: args.schemaVersion,
      uptimeMs: Date.now() - args.startedAt,
      agent: args.agent,
    }),
  );
  get(apiRoutes.guide, (c) => c.json({ markdown: CLI_SKILL_MD }));
  registerVaultRoutes(registrars, args.vault, (from, to) =>
    renameNoteWithLinkRewrite({
      service: args.vault.service,
      knowledge: args.knowledge,
      from,
      to,
    }),
  );
  registerKnowledgeRoutes(registrars, args.knowledge);

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
    return c.json(body, 404);
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
    // Read once at boot: a prod build's shell is fixed for the process
    // lifetime, and every SPA navigation answers with it. Copied into a plain
    // ArrayBuffer-backed view — hono's `Data` refuses Buffer's ArrayBufferLike.
    const spaShell = new Uint8Array(readFileSync(join(clientDir, SPA_SHELL_FILE_NAME)));
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

    app.on(
      ["GET", "HEAD"],
      "*",
      staticCacheControl(STATIC_NO_STORE_CACHE_CONTROL),
      serveClientFile,
      (c): Response | Promise<Response> => {
        if (acceptsHtml(c.req.header("accept"))) {
          return c.body(spaShell, 200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": STATIC_NO_STORE_CACHE_CONTROL,
          });
        }
        return fallback.startFetch(c.req.raw);
      },
    );

    app.all("*", (c) => fallback.startFetch(c.req.raw));
  }

  return { app, injectWebSocket };
}
