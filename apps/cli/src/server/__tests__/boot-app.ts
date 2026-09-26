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
import { HARNESS_IDS, HARNESSES } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessId, VendorAccount } from "@repo/agent-runtime/acp/harness-registry";
import { onTestFinished } from "vitest";
import { createApp } from "../app";
import type { CloudTransport } from "../cloud/sync-runtime";
import { composeRuntime } from "../compose";
import type { ComposedRuntime, ComposePorts, ComposeRuntimeArgs } from "../compose";
import { createVendorMcpConfigs } from "../connectors/connectors-service";
import type { VendorMcpConfigs } from "../connectors/vendor-mcp-config";
import type { RecordAgentWrites } from "../agents/agent-driver";
import { SignInInProgressError } from "../agents/agent-sign-in";
import type { AgentAccounts, SigningIn } from "../agents/agent-sign-in";
import type { AppConfig } from "../config";
import { createInlineProjector } from "../knowledge/__tests__/inline-projector";
import { closeServer } from "../listen";
import { localRouter } from "../root-router";
import { LOOPBACK_HOST } from "../loopback-origin";
import { authorizationHeader, loopbackOrigin } from "../server-file";
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

export { makeTempDir, TEMP_DIR_FOLDS_CASE } from "./temp-dir";
export { AGENT_COMMIT_AUTHOR, agentCommitMessage } from "../vault/turn-trailers";

export const TEST_SERVER_TOKEN = "test-server-token";

// an in-process Request carries no Host until one is set, and the host guard refuses one naming none.
export const TEST_HOST = "127.0.0.1:4664";

type FakeSignInOutcome = Awaited<ReturnType<AgentAccounts["signIn"]>>;

// a booted suite never runs a vendor binary: every harness answers signed in unless told otherwise.
// A sign-in stays running until it is cancelled, as one the person never finishes in the browser,
// or until a code is pasted, which signs it in as the vendor's own exchange would; `authUrl` is the
// address it says it printed, and `refusal` fails every sign-in at once with that detail. A sign-out
// signs the harness out.
export const fakeAgentAccounts = (
  answers: Partial<Record<HarnessId, VendorAccount>> = {},
  signIn: { authUrl?: string; refusal?: string } = {},
): AgentAccounts => {
  const accounts = new Map<HarnessId, VendorAccount>(
    HARNESS_IDS.map((id) => [
      id,
      answers[id] ?? { email: null, label: HARNESSES[id].displayName, state: "signed-in" },
    ]),
  );
  const disposed = new AbortController();
  let current: { progress: SigningIn; finish: (outcome: FakeSignInOutcome) => void } | null = null;
  return {
    dispose: async () => {
      disposed.abort();
      await Promise.resolve();
    },
    invalidate: () => {
      /* empty */
    },
    signIn: async (id, cancel) => {
      if (current !== null) {
        throw new SignInInProgressError(HARNESSES[current.progress.id]);
      }
      if (signIn.refusal !== undefined) {
        return { detail: signIn.refusal, outcome: "failed" };
      }
      const ended = Promise.withResolvers<FakeSignInOutcome>();
      const stopped = AbortSignal.any([cancel, disposed.signal]);
      const stop = (): void => {
        ended.resolve({ outcome: "cancelled" });
      };
      current = {
        finish: ended.resolve,
        progress: {
          acceptsCode: HARNESSES[id].signIn.kind === "terminal",
          authUrl: signIn.authUrl ?? null,
          id,
        },
      };
      if (stopped.aborted) {
        stop();
      }
      stopped.addEventListener("abort", stop, { once: true });
      try {
        return await ended.promise;
      } finally {
        stopped.removeEventListener("abort", stop);
        current = null;
      }
    },
    signOut: async (id) => {
      accounts.set(id, { state: "signed-out" });
      return await Promise.resolve({ outcome: "signed-out" });
    },
    signingIn: () => (current === null ? null : { ...current.progress }),
    status: async (id) => await Promise.resolve(accounts.get(id) ?? { state: "signed-out" }),
    submitCode: (id, code) => {
      const method = HARNESSES[id].signIn;
      if (method.kind !== "terminal" || current?.progress.id !== id) {
        return "not-waiting";
      }
      if (!method.acceptsCode(code)) {
        return "incomplete";
      }
      accounts.set(id, { email: null, label: HARNESSES[id].displayName, state: "signed-in" });
      current.finish({ outcome: "signed-in" });
      return "sent";
    },
  };
};

// what a booted app calls itself before a sign-in names it, so no suite reads the host's own name.
export const TEST_MACHINE_NAME = "Test Mac";

export interface BootTestAppOptions {
  agent?: AgentStatus;
  // absent, every harness answers signed in.
  accounts?: AgentAccounts;
  // omitted, the real transport does nothing: a scratch data dir holds no device credential.
  cloudTransport?: CloudTransport;
  clientDir?: string;
  // absent, the bundled vendors over stores of the instance's own, so no suite edits the Mac's.
  connectors?: VendorMcpConfigs;
  port?: number;
  // the vault's place under the instance dir, which is the config's home too; absent, "vault".
  vaultPath?: string;
  // the vault remote the config, the vault's origin and a credential derive; absent, none.
  derivedRemote?: boolean;
  makeDriver?: (deps: { db: DbConnection; bus: WsBus; vault: VaultRuntime; vaultDir: string }) => {
    createTurnDriver: CreateTurnDriver;
    dispose?: () => Promise<void>;
    recordAgentWrites?: RecordAgentWrites;
    // absent, `agent` answers every request.
    status?: () => AgentStatus;
  };
}

export interface BootedTestApp {
  composed: ComposedRuntime & ReturnType<typeof createApp>;
  bus: WsBus;
  client: RouterClient<typeof localRouter>;
  // from the loopback host, carrying the bearer.
  request: (input: string, init?: RequestInit) => Promise<Response>;
  // from the loopback host, carrying whatever credential `init` does.
  bareRequest: (input: string, init?: RequestInit) => Promise<Response>;
  config: AppConfig;
  // the vendor configs Settings' connectors read and write, as wired.
  connectors: VendorMcpConfigs;
  db: DbConnection;
  vault: VaultRuntime;
  vaultDir: string;
  dataDir: string;
}

// what a booted instance hands a vendor it runs: the host's env, but the vendor's stores (and the
// home a store defaults under) are the instance's own. codex refuses a CODEX_HOME that does not exist.
const instanceVendorEnv = (instanceDir: string): NodeJS.ProcessEnv => {
  const home = path.join(instanceDir, "vendor-home");
  const stores = {
    CLAUDE_CONFIG_DIR: path.join(home, "claude"),
    CODEX_HOME: path.join(home, "codex"),
  };
  for (const dir of Object.values(stores)) {
    mkdirSync(dir, { recursive: true });
  }
  return { ...process.env, ...stores, HOME: home };
};

export const bootTestApp = async (options: BootTestAppOptions = {}): Promise<BootedTestApp> => {
  const instanceDir = makeTempDir("inteligir-app-test-");
  const dataDir = path.join(instanceDir, "data");
  const vaultDir = path.join(instanceDir, options.vaultPath ?? "vault");
  // pre-created so the boot is not virgin and seeds no starter note.
  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const agent = options.agent ?? { detail: null, mode: "off", runtime: "off" };
  const config: AppConfig = {
    agent: agent.mode,
    agentModels: { claude: null, codex: null },
    cloudUrl: "https://cloud.test",
    dataDir,
    dataDirSource: "env",
    databasePath: path.join(dataDir, "inteligir.db"),
    debug: new Set(),
    homeDir: instanceDir,
    mode: "dev",
    port: options.port ?? 0,
    portSource: "env",
    rootDataDir: dataDir,
    slowReads: null,
    vaultDir,
    vaultDirSource: "env",
    vaultRemote: null,
    // tests drive syncNow directly; a timer would race the assertions.
    vaultSyncIntervalMs: null,
    warnings: [],
  };

  const ports: ComposePorts = {
    knowledge: { projector: createInlineProjector() },
    machineName: TEST_MACHINE_NAME,
    vault:
      options.derivedRemote === true
        ? { gitEnv: hermeticGitEnv(), watch: false }
        : { gitEnv: hermeticGitEnv(), remote: () => null, watch: false },
  };
  const connectors =
    options.connectors ??
    createVendorMcpConfigs({ cwd: dataDir, env: instanceVendorEnv(instanceDir) });
  ports.connectors = connectors;

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
        accounts: options.accounts ?? fakeAgentAccounts(),
        createTurnDriver: made?.createTurnDriver ?? (() => unavailableTurnDriver),
        dispose:
          made?.dispose ??
          (async () => {
            await Promise.resolve();
          }),
        recordAgentWrites:
          made?.recordAgentWrites ??
          (() => {
            /* empty */
          }),
        status: made?.status ?? (() => agent),
      };
    },
    ports,
    servesUi: options.clientDir !== undefined,
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
    context: runtime.context,
    serverToken: TEST_SERVER_TOKEN,
  });
  const composed = { ...runtime, ...wired };
  const client = createRouterClient(localRouter, {
    context: {
      ...runtime.context,
      agentThreadId: null,
    },
  });
  const bareRequest = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (!headers.has("host")) {
      headers.set("host", TEST_HOST);
    }
    return await composed.app.request(input, { ...init, headers });
  };
  const request = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", authorizationHeader(TEST_SERVER_TOKEN));
    return await bareRequest(input, { ...init, headers });
  };
  return {
    bareRequest,
    bus: runtime.bus,
    client,
    composed,
    config,
    connectors,
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
  const server = serve({ fetch: booted.composed.app.fetch, hostname: LOOPBACK_HOST, port: 0 });
  booted.composed.injectWebSocket(server);
  onTestFinished(async () => {
    // a suite that is about the listener's teardown closes it itself.
    if (!server.listening) {
      return;
    }
    await closeServer(server, booted.composed.upgradedSockets);
  });
  if (server.address() === null) {
    await once(server, "listening");
  }
  const { port } = boundAddressSchema.parse(server.address());
  const client: RouterClient<typeof localRouter> = createORPCClient(
    new RPCLink({
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
      origin: loopbackOrigin(port),
      url: RPC_PREFIX,
    }),
  );
  return { client, port, server };
};
