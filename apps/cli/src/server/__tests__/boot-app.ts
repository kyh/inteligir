// ONE parameterized boot for the in-process app suites: the SAME composition
// root serve.ts runs (`composeRuntime`), over a scratch instance dir and the
// hermetic ports — no watcher fork, hermetic git, no remote, the scripted
// transcriber, an injectable turn driver — plus the wired hono app and the
// typed in-process client. The composed teardown is run whole by this
// module's own afterEach, so consumers register no cleanup of their own.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DbConnection } from "@repo/db/connection";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { afterEach } from "vitest";
import { createApp } from "../app";
import type { OpenExternalUrl } from "../cloud/browser-opener";
import type { CloudTransport } from "../cloud/sync-runtime";
import {
  composeRuntime,
  type ComposedRuntime,
  type ComposePorts,
  type ComposeRuntimeArgs,
} from "../compose";
import type { AppConfig } from "../config";
import { localRouter } from "../root-router";
import { authorizationHeader } from "../server-file";
import { unavailableTurnDriver, type CreateTurnDriver } from "../threads/turn-driver";
import { hermeticGitEnv } from "../vault/__tests__/git-test-env";
import type { VaultRuntime } from "../vault/vault-runtime";
import type { WsBus } from "../ws-bus";
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
  /** The composed runtime plus the app wired over it — the same value shape
   *  serve.ts boots, minus listen. */
  composed: ComposedRuntime & ReturnType<typeof createApp>;
  bus: WsBus;
  /** The typed client, calling procedures IN-PROCESS — no socket, no HTTP.
   *  A refusal arrives as a thrown ORPCError, which is what `safe()` narrows. */
  client: RouterClient<typeof localRouter>;
  /** One in-process request, carrying this boot's device token — what every
   *  privileged surface requires. Tests that are ABOUT the gate call
   *  `composed.app.request` directly and present whatever they mean to. */
  request: (input: string, init?: RequestInit) => Promise<Response>;
  config: AppConfig;
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

  const agent = options.agent ?? { mode: "off", runtime: "off", detail: null };
  const config: AppConfig = {
    databasePath: join(dataDir, "inteligir.db"),
    dataDir,
    dataDirSource: "env",
    mode: "dev",
    port: options.port ?? 0,
    portSource: "env",
    vaultDir,
    vaultRemote: null,
    // Tests drive syncNow directly; a timer would race the assertions.
    vaultSyncIntervalMs: null,
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
  };

  const ports: ComposePorts = {
    inference: { availability: { kind: "available" }, infer: () => Promise.resolve(null) },
    vault: { watch: false, gitEnv: hermeticGitEnv(), remote: () => null },
  };
  if (options.openExternalUrl !== undefined) ports.openExternalUrl = options.openExternalUrl;

  const composeArgs: ComposeRuntimeArgs = {
    config,
    env: {},
    version: "0.1.0-test",
    ports,
    driver: (deps) => {
      const made = options.makeDriver?.({
        db: deps.db,
        bus: deps.bus,
        vault: deps.vault,
        vaultDir,
      });
      return {
        status: agent,
        createTurnDriver: made?.createTurnDriver ?? (() => unavailableTurnDriver),
        dispose: made?.dispose ?? (() => Promise.resolve()),
      };
    },
  };
  if (options.cloudTransport !== undefined) composeArgs.cloudTransport = options.cloudTransport;
  const runtime = await composeRuntime(composeArgs);
  // The composed teardown IS the cleanup, in its own order — the same steps
  // serve.ts's shutdown runs, minus the listener no test binds.
  cleanups.push(async () => {
    for (const step of runtime.teardown) {
      await step.run();
    }
  });

  const wired = createApp({
    context: runtime.context,
    bus: runtime.bus,
    voiceStreamHub: runtime.voiceStreamHub,
    serverToken: TEST_SERVER_TOKEN,
    clientDir: options.clientDir ?? null,
    configuredPort: config.port,
  });
  const composed = { ...runtime, ...wired };
  const client = createRouterClient(localRouter, {
    context: {
      ...runtime.context,
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
  return {
    composed,
    bus: runtime.bus,
    client,
    request,
    config,
    db: runtime.db,
    vault: runtime.context.vault,
    vaultDir,
    dataDir,
  };
}
