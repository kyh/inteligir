import { once } from "node:events";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { DbConnection } from "@repo/db/connection";
import { RPC_PREFIX } from "@repo/api/local/routes";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import { createRouterClient } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { onTestFinished } from "vitest";
import { createApp } from "../app";
import type { OpenExternalUrl } from "../cloud/browser-opener";
import type { CloudTransport } from "../cloud/sync-runtime";
import { composeRuntime } from "../compose";
import type { ComposedRuntime, ComposePorts, ComposeRuntimeArgs } from "../compose";
import type { AppConfig } from "../config";
import { localRouter } from "../root-router";
import { authorizationHeader } from "../server-file";
import type { ShutdownStep } from "../shutdown";
import { unavailableTurnDriver } from "../threads/turn-driver";
import type { CreateTurnDriver } from "../threads/turn-driver";
import { hermeticGitEnv } from "../vault/__tests__/git-test-env";
import type { VaultRuntime } from "../vault/vault-runtime";
import type { WsBus } from "../ws-bus";
import { boundAddressSchema } from "./bound-address";
import { FakeTurnDriver } from "./fake-turn-driver";
import type { FakeTurnDriverOptions } from "./fake-turn-driver";
import { makeTempDir } from "./temp-dir";

export { makeTempDir } from "./temp-dir";

export const TEST_SERVER_TOKEN = "test-server-token";

export interface BootTestAppOptions {
  agent?: AgentStatus;
  // omitted, the real transport does nothing: a scratch data dir holds no device credential.
  cloudTransport?: CloudTransport;
  clientDir?: string;
  // a suite that begins a connector authorization must supply this, or `pnpm test` pops a browser window.
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

export const bootTestApp = async (options: BootTestAppOptions = {}): Promise<BootedTestApp> => {
  const instanceDir = makeTempDir("inteligir-app-test-");
  const dataDir = path.join(instanceDir, "data");
  const vaultDir = path.join(instanceDir, "vault");
  // pre-created so the boot is not virgin and seeds no starter note.
  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const agent = options.agent ?? { detail: null, mode: "off", runtime: "off" };
  const config: AppConfig = {
    agent: agent.mode,
    agentModel: null,
    cloudUrl: "https://cloud.test",
    dataDir,
    dataDirSource: "env",
    databasePath: path.join(dataDir, "inteligir.db"),
    mode: "dev",
    // not ~/.inteligir/models: `remove` is under test and would delete a developer's downloaded model.
    modelDir: path.join(instanceDir, "models"),
    port: options.port ?? 0,
    portSource: "env",
    rootDataDir: dataDir,
    vaultDir,
    vaultDirSource: "env",
    vaultRemote: null,
    // tests drive syncNow directly; a timer would race the assertions.
    vaultSyncIntervalMs: null,
    // never `auto`: the real runtime dlopens a native binding, making every route test a claim about this platform.
    voice: options.voice ?? "scripted",
  };

  const ports: ComposePorts = {
    vault: { gitEnv: hermeticGitEnv(), remote: () => null, watch: false },
  };
  if (options.openExternalUrl !== undefined) {
    ports.openExternalUrl = options.openExternalUrl;
  }

  // registered before composing: a compose that throws part-way has a database open, and the steps already on the array release it.
  const teardown: ShutdownStep[] = [];
  onTestFinished(async () => {
    for (const step of teardown) {
      await step.run();
    }
  });
  const composeArgs: ComposeRuntimeArgs = {
    config,
    driver: (deps) => {
      const made = options.makeDriver?.({
        bus: deps.bus,
        db: deps.db,
        vault: deps.vault,
        vaultDir,
      });
      return {
        createTurnDriver: made?.createTurnDriver ?? (() => unavailableTurnDriver),
        dispose:
          made?.dispose ??
          (async () => {
            await Promise.resolve();
          }),
        status: agent,
      };
    },
    ports,
    teardown,
    version: "0.1.0-test",
  };
  if (options.cloudTransport !== undefined) {
    composeArgs.cloudTransport = options.cloudTransport;
  }
  const runtime = await composeRuntime(composeArgs);

  const wired = createApp({
    bus: runtime.bus,
    clientDir: options.clientDir ?? null,
    configuredPort: config.port,
    context: runtime.context,
    serverToken: TEST_SERVER_TOKEN,
    voiceStreamHub: runtime.voiceStreamHub,
  });
  const composed = { ...runtime, ...wired };
  const client = createRouterClient(localRouter, {
    context: {
      ...runtime.context,
      // no request reached this client, so the procedure that needs a callback host refuses.
      requestHost: undefined,
    },
  });
  const request = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", authorizationHeader(TEST_SERVER_TOKEN));
    return await composed.app.request(input, { ...init, headers });
  };
  return {
    bus: runtime.bus,
    client,
    composed,
    config,
    dataDir,
    db: runtime.db,
    request,
    vault: runtime.context.vault,
    vaultDir,
  };
};

export interface ThreadHarness extends BootedTestApp {
  driver: FakeTurnDriver;
}

export const bootThreadHarness = async (
  driverOptions: FakeTurnDriverOptions,
  options: Omit<BootTestAppOptions, "makeDriver"> = {},
): Promise<ThreadHarness> => {
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
};

export interface ListeningTestApp {
  server: ReturnType<typeof serve>;
  port: number;
  client: RouterClient<typeof localRouter>;
}

export const listenTestApp = async (booted: BootedTestApp): Promise<ListeningTestApp> => {
  const server = serve({ fetch: booted.composed.app.fetch, hostname: "127.0.0.1", port: 0 });
  booted.composed.injectWebSocket(server);
  onTestFinished(async () => {
    // a suite that is about the listener's teardown closes it itself.
    if (!server.listening) {
      return;
    }
    server.close();
    await once(server, "close");
  });
  if (server.address() === null) {
    await once(server, "listening");
  }
  const { port } = boundAddressSchema.parse(server.address());
  const client: RouterClient<typeof localRouter> = createORPCClient(
    new RPCLink({
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
      origin: `http://127.0.0.1:${port}`,
      url: RPC_PREFIX,
    }),
  );
  return { client, port, server };
};
