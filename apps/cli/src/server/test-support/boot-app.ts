import { once } from "node:events";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { DbConnection } from "@repo/db/connection";
import { RPC_PREFIX } from "@repo/contract/local/routes";
import type { AgentStatus } from "@repo/contract/local/system/system-schema";
import { createRouterClient } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { HARNESS_IDS } from "@repo/domain/harness";
import type { HarnessId } from "@repo/domain/harness";
import { HARNESSES } from "@repo/agent-runtime/acp/harness-registry";
import type { VendorAccount } from "@repo/agent-runtime/acp/harness-registry";
import { afterAll, beforeAll, onTestFinished } from "vitest";
import { createApp } from "../app";
import type { CloudTransport } from "../cloud/sync-runtime";
import type { VaultRemoteProvider } from "../cloud/vault-remote";
import { composeRuntime } from "../compose";
import type { ComposedRuntime, ComposePorts, ComposeRuntimeArgs } from "../compose";
import { offlineFetcher } from "../items/capture/test-support/offline-fetcher";
import type { CapturePorts } from "../items/capture/capture-ports";
import { createVendorMcpConfigs } from "../connectors/connectors-service";
import type { VendorMcpConfigs } from "../connectors/vendor-mcp-config";
import { SignInInProgressError } from "../agents/agent-sign-in";
import type { AgentAccounts, SigningIn } from "../agents/agent-sign-in";
import type { AppConfig } from "../config";
import type { ItemsService } from "../items/items-service";
import type { ImageDownscale } from "../media/image-downscale";
import { createInlineProjector } from "../knowledge/test-support/inline-projector";
import { closeServer } from "../listen";
import { localRouter } from "../root-router";
import type { LocalRouter } from "../root-router";
import { LOOPBACK_HOST } from "../loopback-origin";
import { authorizationHeader, loopbackOrigin } from "../server-file";
import type { ShutdownStep } from "../shutdown";
import { unavailableTurnDriver } from "../threads/turn-driver";
import type { ProviderEventSink, TurnDriver } from "../threads/turn-driver";
import { hermeticGit } from "../vault/test-support/git-test-env";
import type { ReadStall, SlowReads } from "../vault/slow-reads";
import type { VaultRuntime } from "../vault/vault-runtime";
import type { WsBus } from "../ws-bus";
import { boundAddressSchema } from "./bound-address";
import { FakeTurnDriver } from "./fake-turn-driver";
import type { FakeTurnDriverOptions } from "./fake-turn-driver";
import { makeTempDir } from "./temp-dir";
import type { TempDirOptions } from "./temp-dir";

export { makeTempDir, TEMP_DIR_FOLDS_CASE } from "./temp-dir";
export { AGENT_COMMIT_AUTHOR, agentCommitMessage } from "../vault/turn-trailers";
export { FAKE_ACCOUNT, FakeCloud } from "../cloud/test-support/fake-cloud";

export const TEST_SERVER_TOKEN = "test-server-token";

// the release a booted app answers as, which a CLI resolving it through server.json must share
export const TEST_SERVER_VERSION = "0.1.0-test";

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
  let current: {
    progress: SigningIn;
    finish: (outcome: FakeSignInOutcome) => void;
    ended: Promise<FakeSignInOutcome>;
  } | null = null;
  return {
    cancel: async (id) => {
      const running = current;
      if (running?.progress.id !== id) {
        return;
      }
      running.finish({ outcome: "cancelled" });
      await Promise.allSettled([running.ended]);
    },
    dispose: async () => {
      disposed.abort();
      await Promise.resolve();
    },
    signIn: async (id) => {
      if (current !== null) {
        throw new SignInInProgressError(HARNESSES[current.progress.id]);
      }
      if (signIn.refusal !== undefined) {
        return { detail: signIn.refusal, outcome: "failed" };
      }
      const ended = Promise.withResolvers<FakeSignInOutcome>();
      const stop = (): void => {
        ended.resolve({ outcome: "cancelled" });
      };
      current = {
        ended: ended.promise,
        finish: ended.resolve,
        progress: {
          acceptsCode: HARNESSES[id].signIn.kind === "terminal",
          authUrl: signIn.authUrl ?? null,
          id,
        },
      };
      if (disposed.signal.aborted) {
        stop();
      }
      disposed.signal.addEventListener("abort", stop, { once: true });
      try {
        return await ended.promise;
      } finally {
        disposed.signal.removeEventListener("abort", stop);
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

// what releases a boot's handles once its cases are done: absent, the end of the test that booted
// it; a describe that shares one boot across its cases hands in its own (`shareBoot`).
export type Teardown = (step: () => Promise<void>) => void;

const atTestEnd: Teardown = (step) => {
  onTestFinished(step);
};

// a boot's own teardown and its dir's lifetime: a shared boot's dir outlives the case that made
// it, and goes with the file's last one
const lifetimeOf = (
  teardown: Teardown | undefined,
): { teardown: Teardown; dirs: TempDirOptions } =>
  teardown === undefined
    ? { dirs: {}, teardown: atTestEnd }
    : { dirs: { lifetime: "suite" }, teardown };

// one boot for every case of the describe that calls it, made before the first and released after
// the last, each step in the reverse of the order it was registered; read it inside a case. The
// release is an afterAll registered after makeTempDir's, so it runs before the suite's dirs go.
export const shareBoot = <T>(boot: (teardown: Teardown) => Promise<T>): (() => T) => {
  let held: { value: T } | null = null;
  const steps: (() => Promise<void>)[] = [];
  beforeAll(async () => {
    held = {
      value: await boot((step) => {
        steps.push(step);
      }),
    };
  });
  afterAll(async () => {
    for (const step of steps.splice(0).toReversed()) {
      await step();
    }
  });
  return () => {
    if (held === null) {
      throw new Error("a shared boot is read inside a case, after its beforeAll ran");
    }
    return held.value;
  };
};

export interface BootTestAppOptions {
  agent?: AgentStatus;
  // absent, every harness answers signed in.
  accounts?: AgentAccounts;
  // omitted, the real transport does nothing: a scratch data dir holds no device credential.
  cloudTransport?: CloudTransport;
  clientDir?: string;
  // a development shell's Vite, answering the page in the bundle's place
  uiDevOrigin?: string;
  // absent, the bundled vendors over stores of the instance's own, so no suite edits the Mac's.
  connectors?: VendorMcpConfigs;
  port?: number;
  // the vault's place under the instance dir, which is the config's home too; absent, "vault".
  vaultPath?: string;
  // the vault's remote: "derived" is the one the config, the vault's origin and a credential
  // derive, as a server composes it; absent, none.
  remote?: "derived" | VaultRemoteProvider;
  // INTELIGIR_VAULT_REMOTE's pin, over a derived remote.
  pinnedRemote?: string;
  // the vault's folder is left for the boot to create, so it seeds the starter notes.
  seedsStarters?: boolean;
  // reads of one path held this long inside their slot, as INTELIGIR_SLOW_READS holds them
  slowReads?: SlowReads;
  // reads held inside their slot until the suite lets them go, over `slowReads`
  stallRead?: ReadStall;
  // how long the index waits on a doc's read before it defers it; absent, the runtime's own
  readDeadlineMs?: number;
  // the capture's fetch, worker and clock; absent, a fetch that never answers, so a saved link
  // stays a stub and no page leaves the machine.
  items?: CapturePorts;
  // the thumb route's downscale; absent, the one compose built for this host, which on a Mac is
  // the system's own tool.
  downscale?: ImageDownscale;
  teardown?: Teardown;
  makeDriver?: (deps: {
    db: DbConnection;
    bus: WsBus;
    vault: VaultRuntime;
    vaultDir: string;
    sink: ProviderEventSink;
    items: Pick<ItemsService, "saveLink" | "saveFile">;
  }) => {
    driver: TurnDriver;
    // absent, `agent` answers every request.
    status?: () => AgentStatus;
  };
}

export interface BootedTestApp {
  composed: ComposedRuntime & ReturnType<typeof createApp>;
  bus: WsBus;
  client: RouterClient<LocalRouter>;
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
  // the boot's own lifetime, which its listener shares
  teardown: Teardown;
}

// what a booted instance hands a vendor it runs: the host's env, but the vendor's stores (and the
// home a store defaults under) are the instance's own. codex refuses a CODEX_HOME that does not exist.
export const instanceVendorEnv = (instanceDir: string): NodeJS.ProcessEnv => {
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
  const lifetime = lifetimeOf(options.teardown);
  const instanceDir = makeTempDir("inteligir-app-test-", lifetime.dirs);
  const dataDir = path.join(instanceDir, "data");
  const vaultDir = path.join(instanceDir, options.vaultPath ?? "vault");
  if (options.seedsStarters !== true) {
    // pre-created so the boot is not virgin and seeds no starter note.
    mkdirSync(vaultDir, { recursive: true });
  }
  mkdirSync(dataDir, { recursive: true });

  const agent = options.agent ?? { mode: "off" };
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
    slowReads: options.slowReads ?? null,
    vaultDir,
    vaultDirSource: "env",
    vaultRemote: options.pinnedRemote ?? null,
    // tests drive syncNow directly; a timer would race the assertions.
    vaultSyncIntervalMs: null,
  };

  const ports: ComposePorts = {
    items: options.items ?? { fetcher: offlineFetcher },
    knowledge: { projector: createInlineProjector(), readDeadlineMs: options.readDeadlineMs },
    machineName: TEST_MACHINE_NAME,
    vault:
      options.remote === "derived" || options.pinnedRemote !== undefined
        ? { git: hermeticGit(), stallRead: options.stallRead, watch: false }
        : {
            git: hermeticGit(),
            remote: options.remote ?? (() => null),
            stallRead: options.stallRead,
            watch: false,
          },
  };
  const connectors =
    options.connectors ??
    createVendorMcpConfigs({ cwd: dataDir, env: instanceVendorEnv(instanceDir) });
  ports.connectors = connectors;

  // registered before composing: a compose that throws part-way has a database open, and the steps already on the array release it.
  const teardown: ShutdownStep[] = [];
  lifetime.teardown(async () => {
    for (const step of teardown) {
      await step.run();
    }
  });
  const composeArgs: ComposeRuntimeArgs = {
    accounts: options.accounts ?? fakeAgentAccounts(),
    config,
    driver: (deps) => {
      const made = options.makeDriver?.({
        bus: deps.bus,
        db: deps.db,
        items: deps.items,
        sink: deps.sink,
        vault: deps.vault,
        vaultDir,
      });
      return {
        driver: made?.driver ?? unavailableTurnDriver,
        status: made?.status ?? (() => agent),
      };
    },
    ports,
    servesUi: options.clientDir !== undefined || options.uiDevOrigin !== undefined,
    teardown,
    version: TEST_SERVER_VERSION,
  };
  if (options.cloudTransport !== undefined) {
    composeArgs.cloudTransport = options.cloudTransport;
  }
  const runtime = await composeRuntime(composeArgs);

  const wired = createApp({
    bus: runtime.bus,
    clientDir: options.clientDir ?? null,
    context:
      options.downscale === undefined
        ? runtime.context
        : { ...runtime.context, downscale: options.downscale },
    serverToken: TEST_SERVER_TOKEN,
    uiDevOrigin: options.uiDevOrigin ?? null,
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
    teardown: lifetime.teardown,
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
    makeDriver: ({ sink }) => {
      driver = new FakeTurnDriver(sink, driverOptions);
      return { driver };
    },
  });
  if (driver === null) {
    throw new Error("the fake driver was not constructed");
  }
  return { ...booted, driver };
};

export interface ListeningTestApp {
  server: ReturnType<typeof serve>;
  port: number;
  client: RouterClient<LocalRouter>;
}

export interface ListenTestAppOptions {
  // stands between the socket and the app, handed each request and the app's own answer to it,
  // so a suite can act around an answer (another writer landing bytes just after a read) or
  // answer in the app's place.
  around?: (request: Request, answer: (request: Request) => Promise<Response>) => Promise<Response>;
}

export const listenTestApp = async (
  booted: BootedTestApp,
  options: ListenTestAppOptions = {},
): Promise<ListeningTestApp> => {
  const { app } = booted.composed;
  const { around } = options;
  const server = serve({
    fetch:
      around === undefined
        ? app.fetch
        : async (request, env) =>
            await around(request, async (passed) => await app.fetch(passed, env)),
    hostname: LOOPBACK_HOST,
    port: 0,
  });
  booted.composed.injectWebSocket(server);
  booted.teardown(async () => {
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
  const client: RouterClient<LocalRouter> = createORPCClient(
    new RPCLink({
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
      origin: loopbackOrigin(port),
      url: RPC_PREFIX,
    }),
  );
  return { client, port, server };
};
