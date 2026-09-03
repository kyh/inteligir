import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { DbConnection } from "@repo/db/connection";
import { RPC_PREFIX } from "@repo/api/local/routes";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { onTestFinished } from "vitest";
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
import type { ShutdownStep } from "../shutdown";
import { unavailableTurnDriver, type CreateTurnDriver } from "../threads/turn-driver";
import { hermeticGitEnv } from "../vault/__tests__/git-test-env";
import type { VaultRuntime } from "../vault/vault-runtime";
import type { WsBus } from "../ws-bus";
import { boundAddressSchema } from "./bound-address";
import { FakeTurnDriver, type FakeTurnDriverOptions } from "./fake-turn-driver";
import { makeTempDir } from "./temp-dir";

export { FakeTurnDriver, type FakeTurnDriverOptions, makeTempDir };

export const TEST_SERVER_TOKEN = "test-server-token";

export interface BootTestAppOptions {
  agent?: AgentStatus;
  // omitted, the real transport does nothing: a scratch data dir holds no device credential.
  cloudTransport?: CloudTransport;
  clientDir?: string;
  // a suite that begins a pairing must supply this, or `pnpm test` pops a browser window.
  openExternalUrl?: OpenExternalUrl;
  port?: number;
  voice?: AppConfig["voice"];
  makeDriver?: (deps: { db: DbConnection; bus: WsBus; vault: VaultRuntime; vaultDir: string }) => {
    createTurnDriver: CreateTurnDriver;
    dispose?: () => Promise<void>;
  };
}

export interface BootedTestApp {
  composed: ComposedRuntime & ReturnType<typeof createApp>;
  bus: WsBus;
  client: RouterClient<typeof localRouter>;
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
  // pre-created so the boot is not virgin and seeds no starter note.
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
    // tests drive syncNow directly; a timer would race the assertions.
    vaultSyncIntervalMs: null,
    // not ~/.inteligir/models: `remove` is under test and would delete a developer's downloaded model.
    modelDir: join(instanceDir, "models"),
    // never `auto`: the real runtime dlopens a native binding, making every route test a claim about this platform.
    voice: options.voice ?? "scripted",
    agent: agent.mode,
    agentModel: null,
    cloudUrl: "https://cloud.test",
  };

  const ports: ComposePorts = {
    vault: { watch: false, gitEnv: hermeticGitEnv(), remote: () => null },
  };
  if (options.openExternalUrl !== undefined) ports.openExternalUrl = options.openExternalUrl;

  // registered before composing: a compose that throws part-way has a database open, and the steps already on the array release it.
  const teardown: ShutdownStep[] = [];
  onTestFinished(async () => {
    for (const step of teardown) {
      await step.run();
    }
  });
  const composeArgs: ComposeRuntimeArgs = {
    config,
    version: "0.1.0-test",
    ports,
    teardown,
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
      // no request reached this client, so the two procedures that need a callback host refuse.
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

export interface ThreadHarness extends BootedTestApp {
  driver: FakeTurnDriver;
}

export async function bootThreadHarness(
  driverOptions: FakeTurnDriverOptions,
  options: Omit<BootTestAppOptions, "makeDriver"> = {},
): Promise<ThreadHarness> {
  let driver: FakeTurnDriver | null = null;
  const booted = await bootTestApp({
    ...options,
    makeDriver: () => ({
      createTurnDriver: (sink) => {
        driver = new FakeTurnDriver(sink, driverOptions);
        return driver;
      },
    }),
  });
  if (driver === null) {
    throw new Error("the fake driver was not constructed");
  }
  return { ...booted, driver };
}

export interface ListeningTestApp {
  server: ReturnType<typeof serve>;
  port: number;
  client: RouterClient<typeof localRouter>;
}

export async function listenTestApp(booted: BootedTestApp): Promise<ListeningTestApp> {
  const server = serve({ fetch: booted.composed.app.fetch, hostname: "127.0.0.1", port: 0 });
  booted.composed.injectWebSocket(server);
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        // a suite that is about the listener's teardown closes it itself.
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  if (server.address() === null) {
    await new Promise<void>((resolve) => server.once("listening", resolve));
  }
  const { port } = boundAddressSchema.parse(server.address());
  const client: RouterClient<typeof localRouter> = createORPCClient(
    new RPCLink({
      origin: `http://127.0.0.1:${port}`,
      url: RPC_PREFIX,
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    }),
  );
  return { server, port, client };
}
