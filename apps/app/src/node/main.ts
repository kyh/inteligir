// The shipping process. Boot order: config → db open+migrate → createApp →
// serve → injectWebSocket. Dev mounts Vite in middlewareMode as the fallback
// (one process, HMR untouched); prod serves dist/client and the Start server
// entry's fetch.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import { z } from "zod";
import { createApp, type AppFallback } from "./app";
import { resolveAppConfig } from "./config";
import { ensureDevDataDirOwnership } from "./data-dir";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { listenWithRetry } from "./listen";
import { unavailableTurnDriver } from "./threads/turn-driver";
import { redactRemoteUrl } from "./vault/git";
import { createVaultRuntime } from "./vault/vault-runtime";
import { WsBus } from "./ws-bus";

interface EntryLayout {
  /** The app directory (where package.json and dist/ live). */
  appDirUrl: URL;
  /** Set only for the bundle, which carries its own migrations copy. */
  migrationsFolder?: string;
}

/**
 * The layout this entry runs in: src/node/main.ts under tsx (the app dir is
 * two levels up, migrations come from @repo/db's own source-adjacent default)
 * or dist-node/main.js as the prod bundle (one level up, with the committed
 * migrations copied beside the entry by scripts/build-node-entry.mjs).
 */
function resolveEntryLayout(): EntryLayout {
  const sourceAppDir = new URL("../../", import.meta.url);
  if (existsSync(fileURLToPath(new URL("package.json", sourceAppDir)))) {
    return { appDirUrl: sourceAppDir };
  }
  const bundleAppDir = new URL("../", import.meta.url);
  if (existsSync(fileURLToPath(new URL("package.json", bundleAppDir)))) {
    return {
      appDirUrl: bundleAppDir,
      migrationsFolder: fileURLToPath(new URL("drizzle", import.meta.url)),
    };
  }
  throw new Error("cannot locate the app directory: no package.json beside the entry");
}

const { appDirUrl, migrationsFolder } = resolveEntryLayout();

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

const checkoutPath = process.cwd();
const config = resolveAppConfig({
  checkoutPath,
  env: process.env,
});
mkdirSync(config.dataDir, { recursive: true });
if (config.mode === "dev" && config.dataDirSource === "default") {
  ensureDevDataDirOwnership(config.dataDir, checkoutPath);
}

// Kicked off before the synchronous db open + migrate so the Vite / Start
// module loads overlap them; awaited once the db is ready.
const fallbackPromise = config.mode === "dev" ? createDevFallback() : createProdFallback();

const db = createConnection(config.databasePath);
runMigrations(db, migrationsFolder);
const schemaVersion = getSchemaVersion(db);

const version = readAppVersion();
const bus = new WsBus({ version });
// The knowledge runtime needs the vault service the runtime hands back, so
// the hook late-binds; changes before it exists are covered by the boot
// reconcile the first pass always runs.
let knowledgeRef: KnowledgeRuntime | null = null;
const vault = await createVaultRuntime({
  vaultDir: config.vaultDir,
  vaultRemote: config.vaultRemote,
  dataDir: config.dataDir,
  notifier: bus,
  onFilesChanged: (change) => knowledgeRef?.noteVaultChange(change),
});
const knowledge = createKnowledgeRuntime({
  dataDir: config.dataDir,
  vault: vault.service,
  vaultRoot: config.vaultDir,
});
knowledgeRef = knowledge;
const fallback = await fallbackPromise;

const { app, injectWebSocket } = createApp({
  bus,
  config,
  createTurnDriver: () => unavailableTurnDriver,
  db,
  fallback,
  knowledge,
  schemaVersion,
  startedAt: Date.now(),
  vault,
  version,
});

const { port, server } = await listenWithRetry({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: config.port,
  probeOnBusyPort: config.mode === "dev" && config.portSource === "default",
});
injectWebSocket(server);
console.log(
  `inteligir ${version} (${config.mode}) listening on http://127.0.0.1:${port} — data: ${config.dataDir} — vault: ${config.vaultDir}${config.vaultRemote === null ? "" : ` ⇄ ${redactRemoteUrl(config.vaultRemote)}`}`,
);
