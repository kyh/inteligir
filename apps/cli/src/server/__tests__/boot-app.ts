// ONE parameterized boot for the in-process app suites: a scratch instance
// dir, migrated db, vault runtime with hermetic git, knowledge runtime wired
// to the vault's change announcements, the composed hono app and the typed
// in-process client — the same graph main.ts builds, minus listen. Every
// booted runtime (and an injected driver's dispose) is torn down by this
// module's own afterEach, LIFO, so consumers register no cleanup of their own.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createConnection, type DbConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { afterEach } from "vitest";
import { createApp, type CreateAppArgs } from "../app";
import { localRouter } from "../root-router";
import { createConnectorsService } from "../connectors/connectors-service";
import { createFoldersService } from "../folders/folders-service";
import { createFoldersStore } from "../folders/folders-store";
import { createConnectorsStore } from "../connectors/connectors-store";
import { createConnectorOauthFlow } from "../connectors/oauth-flow";
import { createNoteIntelligence } from "../note-intelligence/note-intelligence";
import { createNoteIntelligenceSettingsStore } from "../note-intelligence/settings-store";
import type { OpenExternalUrl } from "../cloud/browser-opener";
import type { CloudTransport } from "../cloud/sync-runtime";
import type { AppConfig } from "../config";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "../knowledge/knowledge-runtime";
import { unavailableTurnDriver, type CreateTurnDriver } from "../threads/turn-driver";
import { hermeticGitEnv } from "../vault/__tests__/git-test-env";
import { createVaultRuntime, type VaultRuntime } from "../vault/vault-runtime";
import { authorizationHeader } from "../server-file";
import { WsBus } from "../ws-bus";
import { makeTempDir } from "./temp-dir";

// Re-exported so a consumer outside this package reaches the whole harness
// through ONE specifier — the fake provider is half of what makes a booted
// app drivable, and two subpaths for one seam is two things to keep in sync.
export { FakeTurnDriver, type FakeTurnDriverOptions } from "./fake-turn-driver";

/** One fixed token for every booted suite: the file's own tests cover minting
 *  and comparison, and a per-boot value here would only make the client's
 *  header harder to read in a failure. */
export const TEST_SERVER_TOKEN = "test-server-token";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

export interface BootTestAppOptions {
  agent?: AgentStatus;
  /** Omitted, the cloud runtime boots with the real transport — which does
   *  nothing at all, because a scratch data dir holds no device credential. */
  cloudTransport?: CloudTransport;
  /** Omitted, no UI is served (`kind: "none"`) — a suite drives procedures. */
  clientDir?: string;
  /** Omitted, a pairing would reach the real opener — so any suite that begins
   *  one has to supply this, or `pnpm test` pops a browser window. */
  openExternalUrl?: OpenExternalUrl;
  port?: number;
  /** Omitted, the scripted transcriber — see the config block below. */
  voice?: AppConfig["voice"];
  /** Omitted, sends 503 through the unavailable driver. */
  makeDriver?: (deps: { db: DbConnection; bus: WsBus; vault: VaultRuntime; vaultDir: string }) => {
    createTurnDriver: CreateTurnDriver;
    dispose?: () => Promise<void>;
  };
}

export interface BootedTestApp {
  args: CreateAppArgs;
  composed: ReturnType<typeof createApp>;
  bus: WsBus;
  /** The typed client, calling procedures IN-PROCESS — no socket, no HTTP.
   *  A refusal arrives as a thrown ORPCError, which is what `safe()` narrows. */
  client: RouterClient<typeof localRouter>;
  /** One in-process request, carrying this boot's device token — what every
   *  privileged surface requires. Tests that are ABOUT the gate call
   *  `composed.app.request` directly and present whatever they mean to. */
  request: (input: string, init?: RequestInit) => Promise<Response>;
  db: DbConnection;
  vault: VaultRuntime;
  vaultDir: string;
  dataDir: string;
}

export async function bootTestApp(options: BootTestAppOptions = {}): Promise<BootedTestApp> {
  const instanceDir = makeTempDir("inteligir-app-test-");
  const dataDir = join(instanceDir, "data");
  const vaultDir = join(instanceDir, "vault");
  // Pre-created = not a virgin boot: harness vaults stay empty of the
  // starter seed so listing/knowledge expectations see only their own docs.
  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const databasePath = join(dataDir, "inteligir.db");
  const db = createConnection(databasePath);
  const knownSchemaVersion = runMigrations(db);

  const bus = new WsBus({ version: "0.1.0-test" });
  let knowledgeSink: KnowledgeRuntime | null = null;
  const vault = await createVaultRuntime({
    vaultDir,
    vaultRemote: null,
    dataDir,
    notifier: bus,
    onFilesChanged: (change) => knowledgeSink?.noteVaultChange(change),
    watch: false,
    syncIntervalMs: null,
    gitEnv: hermeticGitEnv(),
  });
  cleanups.push(() => vault.dispose());
  const knowledge = createKnowledgeRuntime({ dataDir, vault: vault.service, vaultRoot: vaultDir });
  knowledgeSink = knowledge;
  cleanups.push(() => knowledge.dispose());

  const driver = options.makeDriver?.({ db, bus, vault, vaultDir });
  if (driver?.dispose !== undefined) {
    const dispose = driver.dispose;
    cleanups.push(() => dispose());
  }

  const agent = options.agent ?? { mode: "off", runtime: "off", detail: null };
  const args: CreateAppArgs = {
    agent,
    bus,
    connectors: createConnectorsService(createConnectorsStore(dataDir)),
    connectorsOauth: createConnectorOauthFlow(createConnectorsStore(dataDir)),
    folders: createFoldersService({
      store: createFoldersStore(dataDir),
      vaultDir,
      dataDir,
    }),
    noteIntelligence: createNoteIntelligence({
      infer: () => Promise.resolve(null),
      settings: createNoteIntelligenceSettingsStore(dataDir),
      vault: vault.service,
    }),
    config: {
      databasePath,
      dataDir,
      dataDirSource: "env",
      mode: "dev",
      port: options.port ?? 0,
      portSource: "env",
      vaultDir,
      vaultRemote: null,
      // Under the instance dir rather than ~/.inteligir/models: a suite that
      // shared the machine's real model cache could delete a model a developer
      // downloaded, and `remove` is one of the routes under test.
      modelDir: join(instanceDir, "models"),
      // Never `auto` in a suite: the real runtime dlopens a native binding and
      // would make every route test a claim about this machine's platform.
      voice: options.voice ?? "scripted",
      agent: agent.mode,
      agentModel: null,
      cloudUrl: "https://cloud.test",
    },
    createTurnDriver: driver?.createTurnDriver ?? (() => unavailableTurnDriver),
    db,
    clientDir: options.clientDir ?? null,
    serverToken: TEST_SERVER_TOKEN,
    knowledge,
    schemaVersion: getSchemaVersion(db, knownSchemaVersion),
    startedAt: Date.now(),
    vault,
    version: "0.1.0-test",
  };
  if (options.cloudTransport !== undefined) args.cloudTransport = options.cloudTransport;
  if (options.openExternalUrl !== undefined) args.openExternalUrl = options.openExternalUrl;
  const composed = createApp(args);
  cleanups.push(() => composed.cloud.dispose());
  const client = createRouterClient(localRouter, {
    context: {
      ...composed.services,
      // No request reached this client, so nothing composed a callback URL
      // from a Host header; the two procedures that need one refuse.
      requestHost: undefined,
    },
  });
  const request = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", authorizationHeader(TEST_SERVER_TOKEN));
    return composed.app.request(input, { ...init, headers });
  };
  return { args, composed, bus, client, db, vault, vaultDir, dataDir, request };
}
