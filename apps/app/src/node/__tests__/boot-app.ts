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
  fallback?: AppFallback;
  port?: number;
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
      agent: agent.mode,
      agentModel: null,
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
  const composed = createApp(args);
  const client = createApiClient("http://app.test", {
    fetch: async (input, init) => composed.app.request(input, init),
  });
  return { args, composed, bus, client, db, vault, vaultDir, dataDir };
}
