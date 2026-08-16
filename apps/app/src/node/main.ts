// The shipping process. Boot order: config → db open+migrate → createApp →
// serve → injectWebSocket. Dev mounts Vite in middlewareMode as the fallback
// (one process, HMR untouched); prod serves dist/client and the Start server
// entry's fetch.

import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { createConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { z } from "zod";
import { createApp, type AppFallback } from "./app";
import { resolveAppConfig } from "./config";
import { WsBus } from "./ws-bus";

const appDirUrl = new URL("../../", import.meta.url);

function readAppVersion(): string {
  const raw = readFileSync(new URL("package.json", appDirUrl), "utf8");
  return z.object({ version: z.string().min(1) }).parse(JSON.parse(raw)).version;
}

async function createDevFallback(): Promise<AppFallback> {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: fileURLToPath(appDirUrl),
    server: { middlewareMode: true },
  });
  return { kind: "dev", middlewares: vite.middlewares };
}

function extractStartFetch(
  entryModule: unknown,
  entryPath: string,
): (request: Request) => Promise<Response> {
  if (typeof entryModule !== "object" || entryModule === null || !("default" in entryModule)) {
    throw new Error(`${entryPath} has no default export`);
  }
  const entry = entryModule.default;
  if (typeof entry !== "object" || entry === null || !("fetch" in entry)) {
    throw new Error(`${entryPath} default export has no fetch member`);
  }
  const fetchMember = entry.fetch;
  if (typeof fetchMember !== "function") {
    throw new Error(`${entryPath} default.fetch is not a function`);
  }
  return async (request) => {
    const response: unknown = await fetchMember.call(entry, request);
    if (!(response instanceof Response)) {
      throw new Error(`${entryPath} fetch did not return a Response`);
    }
    return response;
  };
}

async function createProdFallback(): Promise<AppFallback> {
  const clientDir = fileURLToPath(new URL("dist/client", appDirUrl));
  const entryPath = fileURLToPath(new URL("dist/server/server.js", appDirUrl));
  const entryModule: unknown = await import(pathToFileURL(entryPath).href);
  return {
    kind: "prod",
    clientDir,
    startFetch: extractStartFetch(entryModule, entryPath),
  };
}

const config = resolveAppConfig({
  checkoutPath: process.cwd(),
  env: process.env,
});
mkdirSync(config.dataDir, { recursive: true });

const db = createConnection(config.databasePath);
runMigrations(db);

const version = readAppVersion();
const bus = new WsBus({ version });
const fallback = config.mode === "dev" ? await createDevFallback() : await createProdFallback();

const { app, injectWebSocket } = createApp({
  bus,
  config,
  db,
  fallback,
  startedAt: Date.now(),
  version,
});

const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.port }, (info) => {
  console.log(
    `inteligir ${version} (${config.mode}) listening on http://127.0.0.1:${info.port} — data: ${config.dataDir}`,
  );
});
injectWebSocket(server);
