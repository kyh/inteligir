// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// One Hono root splitting /api/v1 (the contract table), GET /ws (the
// invalidation bus), and a fallback — vite middlewares in dev, static client
// + the Start server entry's fetch in prod.

import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { createNodeWebSocket } from "@hono/node-ws";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { HttpBindings } from "@hono/node-server";
import { getSchemaVersion } from "@repo/db/meta";
import type { DbConnection } from "@repo/db/connection";
import { apiRoutes, type ApiErrorResponse, type ApiSchema } from "@repo/server-contract/routes";
import { typedRoutes } from "@repo/typed-routes/typed-routes";
import { Hono, type Context, type Next } from "hono";
import { browserRequestProblem, buildLocalAppOrigins } from "./browser-request-guard";
import type { AppConfig } from "./config";
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
  bus: WsBus;
  config: AppConfig;
  db: DbConnection;
  fallback: AppFallback;
  startedAt: number;
  version: string;
}

const SPA_SHELL_FILE_NAME = "_shell.html";
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_NO_STORE_CACHE_CONTROL = "no-store";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function contentTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** Resolve a URL path inside `rootDir`, refusing traversal outside it. */
function resolveStaticFilePath(rootDir: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) {
    return undefined;
  }
  const relativePath = decoded.replace(/^\/+/u, "");
  if (relativePath.length === 0) {
    return undefined;
  }
  const resolved = resolve(rootDir, relativePath);
  if (!resolved.startsWith(rootDir + sep)) {
    return undefined;
  }
  return resolved;
}

async function readFileIfExists(filePath: string | undefined): Promise<Uint8Array | undefined> {
  if (filePath === undefined) {
    return undefined;
  }
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return undefined;
    }
    return await readFile(filePath);
  } catch {
    return undefined;
  }
}

function staticResponse(body: Uint8Array, filePath: string, cacheControl: string): Response {
  return new Response(body, {
    headers: {
      "content-type": contentTypeFor(filePath),
      "cache-control": cacheControl,
    },
  });
}

function acceptsHtml(acceptHeader: string | undefined): boolean {
  return acceptHeader !== undefined && acceptHeader.includes("text/html");
}

export function createApp(args: CreateAppArgs) {
  const app = new Hono<{ Bindings: HttpBindings }>();
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
        message: problem.error,
      };
      return c.json(body, problem.status);
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
  const { get } = typedRoutes<ApiSchema>(api, {
    onValidationError: (message) => new ApiValidationError(message),
  });

  get(apiRoutes.health, (c) => c.json({ ok: true }));
  get(apiRoutes.system.status, (c) =>
    c.json({
      version: args.version,
      dataDir: args.config.dataDir,
      schemaVersion: getSchemaVersion(args.db),
      uptimeMs: Date.now() - args.startedAt,
    }),
  );

  // Unmatched API paths answer JSON here — an API caller must never receive
  // the SPA shell or a Vite page from the fallthrough below.
  api.all("*", (c) => {
    const body: ApiErrorResponse = { error: "not_found", message: "Not found" };
    return c.json(body, 404);
  });

  app.route("/api/v1", api);

  app.get(
    "/ws",
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
    app.all("*", async (c) => {
      const method = c.req.method;
      if (method === "GET" || method === "HEAD") {
        const path = c.req.path;
        const filePath = resolveStaticFilePath(clientDir, path);
        if (path.startsWith("/assets/")) {
          // An asset miss must 404: answering it with the shell hands the
          // module loader HTML and produces an opaque MIME error instead.
          const body = await readFileIfExists(filePath);
          return body === undefined
            ? c.text("Not found", 404)
            : staticResponse(body, path, STATIC_ASSET_CACHE_CONTROL);
        }
        const body = await readFileIfExists(filePath);
        if (body !== undefined && filePath !== undefined) {
          // Only /assets/* carries content hashes, so only it may be immutable.
          return staticResponse(body, filePath, STATIC_NO_STORE_CACHE_CONTROL);
        }
        if (acceptsHtml(c.req.header("accept"))) {
          const shellBody = await readFileIfExists(join(clientDir, SPA_SHELL_FILE_NAME));
          if (shellBody !== undefined) {
            return staticResponse(shellBody, SPA_SHELL_FILE_NAME, STATIC_NO_STORE_CACHE_CONTROL);
          }
        }
      }
      return fallback.startFetch(c.req.raw);
    });
  }

  return { app, injectWebSocket };
}
