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
import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import type { AgentStatus } from "@repo/server-contract/routes";
import { afterEach } from "vitest";
import { createApp, type AppFallback, type CreateAppArgs } from "../app";
import type { OpenExternalUrl } from "../cloud/browser-opener";
import type { CloudTransport } from "../cloud/sync-runtime";
import type { AppConfig } from "../config";
import type { CodexMcpRunner } from "../connectors/codex-mcp";
import { ensureInstanceSecret } from "../instance-identity";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "../knowledge/knowledge-runtime";
import { unavailableTurnDriver, type CreateTurnDriver } from "../threads/turn-driver";
import { hermeticGitEnv } from "../vault/__tests__/git-test-env";
import { createVaultRuntime, type VaultRuntime } from "../vault/vault-runtime";
import { WsBus } from "../ws-bus";
import { makeTempDir } from "./temp-dir";

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
  /** Omitted, the connector routes drive whatever `codex` this machine has —
   *  so a suite asserting on them injects a fake and never touches the
   *  developer's own `~/.codex/config.toml`. */
  codexMcpRunner?: CodexMcpRunner;
  fallback?: AppFallback;
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
  /** The typed hc client, dialing the composed app in-process. */
  client: ApiClient;
  db: DbConnection;
  vault: VaultRuntime;
  vaultDir: string;
  dataDir: string;
}

export async function bootTestApp(options: BootTestAppOptions = {}): Promise<BootedTestApp> {
  const instanceDir = makeTempDir("inteligir-app-test-");
  const dataDir = join(instanceDir, "data");
  const vaultDir = join(instanceDir, "vault");
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
    config: {
      databasePath,
      dataDir,
      dataDirSource: "env",
      devHmrPort: 0,
      mode: "dev",
      port: options.port ?? 0,
      portSource: "env",
      vaultDir,
      vaultRemote: null,
      // Under the instance dir rather than ~/.inteligir/models: a suite that
      // shared the machine's real model cache could delete a model a developer
      // downloaded, and `remove` is one of the routes under test.
      modelDir: join(instanceDir, "models"),
      // Under the instance dir, disjoint from the vault: `remove` is a route
      // under test, and a suite that shared the machine's real memory dir could
      // delete a fact a developer's own agent recorded.
      memoryDir: join(instanceDir, "memory"),
      // Never `auto` in a suite: the real runtime dlopens a native binding and
      // would make every route test a claim about this machine's platform.
      voice: options.voice ?? "scripted",
      agent: agent.mode,
      agentModel: null,
      cloudUrl: "https://cloud.test",
    },
    createTurnDriver: driver?.createTurnDriver ?? (() => unavailableTurnDriver),
    db,
    fallback: options.fallback ?? { kind: "none" },
    instanceSecret: ensureInstanceSecret(dataDir),
    knowledge,
    schemaVersion: getSchemaVersion(db, knownSchemaVersion),
    startedAt: Date.now(),
    vault,
    version: "0.1.0-test",
  };
  if (options.cloudTransport !== undefined) args.cloudTransport = options.cloudTransport;
  if (options.codexMcpRunner !== undefined) args.codexMcpRunner = options.codexMcpRunner;
  if (options.openExternalUrl !== undefined) args.openExternalUrl = options.openExternalUrl;
  const composed = createApp(args);
  cleanups.push(() => composed.cloud.dispose());
  const client = createApiClient("http://app.test", {
    fetch: async (input, init) => composed.app.request(input, init),
  });
  return { args, composed, bus, client, db, vault, vaultDir, dataDir };
}
