// Boots the REAL thread stack (ThreadService + typed routes on an in-process
// Hono app) for the composer-side suites, driven through the same typed
// client the workspace uses. A slimmer sibling of the node threads suite's
// harness: no ws assertions, so the FakeTurnDriver and the vault/knowledge
// runtimes are the only moving parts.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, type DbConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import { createApp, type CreateAppArgs } from "../../../node/app";
import { createKnowledgeRuntime } from "../../../node/knowledge/knowledge-runtime";
import type { CreateTurnDriver } from "../../../node/threads/turn-driver";
import { hermeticGitEnv } from "../../../node/vault/__tests__/git-test-env";
import { createVaultRuntime } from "../../../node/vault/vault-runtime";
import { WsBus } from "../../../node/ws-bus";
import {
  FakeTurnDriver,
  type FakeTurnDriverOptions,
} from "../../../node/__tests__/fake-turn-driver";

export interface ChatHarness {
  client: ApiClient;
  db: DbConnection;
  driver: FakeTurnDriver;
  vaultDir: string;
}

export async function bootChatHarness(
  options: FakeTurnDriverOptions,
  cleanups: Array<() => void | Promise<void>>,
): Promise<ChatHarness> {
  const instanceDir = mkdtempSync(join(tmpdir(), "inteligir-chat-test-"));
  cleanups.push(() => rmSync(instanceDir, { recursive: true, force: true }));
  const dataDir = join(instanceDir, "data");
  const vaultDir = join(instanceDir, "vault");
  mkdirSync(dataDir, { recursive: true });
  const databasePath = join(dataDir, "inteligir.db");
  const db = createConnection(databasePath);
  runMigrations(db);

  let driver: FakeTurnDriver | null = null;
  const createTurnDriver: CreateTurnDriver = (sink) => {
    driver = new FakeTurnDriver(sink, options);
    return driver;
  };

  const bus = new WsBus({ version: "0.1.0-test" });
  const vault = await createVaultRuntime({
    vaultDir,
    vaultRemote: null,
    dataDir,
    notifier: bus,
    watch: false,
    syncIntervalMs: null,
    gitEnv: hermeticGitEnv(),
  });
  cleanups.push(() => vault.dispose());
  const knowledge = createKnowledgeRuntime({ dataDir, vault: vault.service, vaultRoot: vaultDir });
  cleanups.push(() => knowledge.dispose());
  const args: CreateAppArgs = {
    agent: { mode: "off", runtime: "off", detail: null },
    bus,
    config: {
      databasePath,
      dataDir,
      dataDirSource: "env",
      mode: "dev",
      port: 0,
      portSource: "env",
      vaultDir,
      vaultRemote: null,
      agent: "off",
      agentModel: null,
    },
    createTurnDriver,
    db,
    fallback: { kind: "none" },
    knowledge,
    schemaVersion: 2,
    startedAt: Date.now(),
    vault,
    version: "0.1.0-test",
  };
  const composed = createApp(args);
  const client = createApiClient("http://chat.test", {
    fetch: async (input, init) => composed.app.request(input, init),
  });
  if (driver === null) {
    throw new Error("the driver was not constructed");
  }
  return { client, db, driver, vaultDir };
}
