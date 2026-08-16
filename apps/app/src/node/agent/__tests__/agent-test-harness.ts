// Boots the REAL app (routes, ThreadService, vault runtime with git, ws bus)
// around an injected agent driver — the shared harness for the driver e2e
// suites. HTTP goes through the composed hono app, exactly as production
// serves it.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, type DbConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import type { AgentStatus } from "@repo/server-contract/routes";
import {
  threadSchema,
  pendingInteractionSchema,
  timelineResponseSchema,
  type PendingInteraction,
  type TimelineResponse,
} from "@repo/server-contract/threads";
import type { TimelineRow } from "@repo/server-contract/thread-timeline";
import { expect } from "vitest";
import { z } from "zod";
import { createApp } from "../../app";
import { createKnowledgeRuntime } from "../../knowledge/knowledge-runtime";
import type { CreateTurnDriver } from "../../threads/turn-driver";
import { hermeticGitEnv } from "../../vault/__tests__/git-test-env";
import { createVaultRuntime, type VaultRuntime } from "../../vault/vault-runtime";
import { WsBus } from "../../ws-bus";

export interface AgentAppHarness {
  bus: WsBus;
  client: ApiClient;
  db: DbConnection;
  vault: VaultRuntime;
  vaultDir: string;
}

export interface BootAgentAppArgs {
  agent: AgentStatus;
  cleanups: Array<() => void | Promise<void>>;
  makeDriver: (deps: { db: DbConnection; bus: WsBus; vault: VaultRuntime; vaultDir: string }) => {
    createTurnDriver: CreateTurnDriver;
    dispose?: () => Promise<void>;
  };
}

const threadEnvelopeSchema = z.object({ thread: threadSchema });
const threadDetailSchema = z.object({
  thread: threadSchema,
  pendingInteractions: z.array(pendingInteractionSchema),
});
const startedResponseSchema = z.object({ kind: z.literal("started"), turnId: z.string().min(1) });

export async function bootAgentApp(args: BootAgentAppArgs): Promise<AgentAppHarness> {
  const instanceDir = mkdtempSync(join(tmpdir(), "inteligir-agent-test-"));
  args.cleanups.push(() => rmSync(instanceDir, { recursive: true, force: true }));
  const dataDir = join(instanceDir, "data");
  const vaultDir = join(instanceDir, "vault");
  mkdirSync(dataDir, { recursive: true });
  const databasePath = join(dataDir, "inteligir.db");
  const db = createConnection(databasePath);
  runMigrations(db);

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
  args.cleanups.push(() => vault.dispose());
  const knowledge = createKnowledgeRuntime({ dataDir, vault: vault.service, vaultRoot: vaultDir });
  args.cleanups.push(() => knowledge.dispose());

  const driver = args.makeDriver({ db, bus, vault, vaultDir });
  if (driver.dispose !== undefined) {
    const dispose = driver.dispose;
    args.cleanups.push(() => dispose());
  }

  const composed = createApp({
    agent: args.agent,
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
      agent: args.agent.mode,
      agentModel: null,
    },
    createTurnDriver: driver.createTurnDriver,
    db,
    fallback: { kind: "none" },
    knowledge,
    schemaVersion: getSchemaVersion(db),
    startedAt: Date.now(),
    vault,
    version: "0.1.0-test",
  });
  const client = createApiClient("http://agent.test", {
    fetch: async (input, init) => composed.app.request(input, init),
  });
  return { bus, client, db, vault, vaultDir };
}

export async function createThread(client: ApiClient): Promise<string> {
  const response = await client.threads.create.$post({ json: {} });
  expect(response.status).toBe(201);
  return threadEnvelopeSchema.parse(await response.json()).thread.id;
}

export async function sendMessage(
  client: ApiClient,
  threadId: string,
  text: string,
): Promise<string> {
  const response = await client.threads.send.$post({
    json: { threadId, text, mode: "steer-if-active" },
  });
  expect(response.status).toBe(200);
  return startedResponseSchema.parse(await response.json()).turnId;
}

export async function getThreadDetail(
  client: ApiClient,
  threadId: string,
): Promise<{ status: string; pendingInteractions: PendingInteraction[] }> {
  const response = await client.threads.get.$get({ query: { threadId } });
  expect(response.status).toBe(200);
  const detail = threadDetailSchema.parse(await response.json());
  return { status: detail.thread.status, pendingInteractions: detail.pendingInteractions };
}

export async function fetchTimelineRows(
  client: ApiClient,
  threadId: string,
): Promise<TimelineRow[]> {
  const response = await client.threads.timeline.$get({ query: { threadId } });
  expect(response.status).toBe(200);
  const parsed: TimelineResponse = timelineResponseSchema.parse(await response.json());
  if (parsed.kind !== "full") {
    throw new Error("expected a full timeline");
  }
  return parsed.timeline.rows;
}

/** Work rows nest as children of their turn row; flatten for assertions. */
export function flattenTimelineRows(rows: TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) => (row.kind === "turn" ? [row, ...row.children] : [row]));
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined> | T | undefined,
  what: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
