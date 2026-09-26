// reachable from the renderer's suites through `inteligir/server/testing`, so everything imported
// here compiles under the browser tsconfig: the cloud socket opener, the acp agent runtime and the
// vendor account probe are injected (`cloudTransport`, `driver`, which carries `accounts`) rather
// than imported, and serve.ts supplies the real ones.

import { closeConnection, createConnection } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import { resolveMigrationsFolder } from "../paths";
import type { ResolvedAgentDriver } from "./agents/agent-driver";
import { AgentPrefsStore } from "./agents/agent-prefs-store";
import { createAgentsService } from "./agents/agents-service";
import { listTurnChanges, undoTurnChanges } from "./agents/turn-changes";
import { createBrowserSession } from "./browser-session";
import { createCommentsService } from "./comments/comments-service";
import { systemOpenExternalUrl } from "./browser-opener";
import type { OpenExternalUrl } from "./browser-opener";
import { createCloudRuntime } from "./cloud/sync-runtime";
import type { CloudRuntimeArgs, CloudTransport } from "./cloud/sync-runtime";
import { createVaultRemoteProvider } from "./cloud/vault-remote";
import type { VaultRemoteProvider } from "./cloud/vault-remote";
import type { AppConfig } from "./config";
import { createConnectorsService } from "./connectors/connectors-service";
import type { ConnectorsService } from "./connectors/connectors-service";
import { ConnectorsStore } from "./connectors/connectors-store";
import { createConnectorOauthFlow } from "./connectors/oauth-flow";
import type { ConnectorOauthFlow } from "./connectors/oauth-flow";
import { debugLog } from "./debug-log";
import { messageOf } from "./error-message";
import { createFoldersService } from "./folders/folders-service";
import type { FoldersService } from "./folders/folders-service";
import { FoldersStore } from "./folders/folders-store";
import { createKnowledgeRuntime } from "./knowledge/knowledge-runtime";
import type { KnowledgeRuntime, KnowledgeRuntimeArgs } from "./knowledge/knowledge-runtime";
import { createProjectionWorker } from "./knowledge/projector";
import { renameNoteWithLinkRewrite } from "./knowledge/rename";
import { renameTagAcrossVault } from "./knowledge/rename-tag";
import type { AppServices } from "./orpc";
import { teardownStep } from "./shutdown";
import type { ShutdownStep, TeardownStepName } from "./shutdown";
import { ThreadService } from "./threads/service";
import { createThreadOrigins } from "./threads/thread-origins";
import { slowReadStall } from "./vault/slow-reads";
import { createVaultRuntime } from "./vault/vault-runtime";
import type { VaultRuntime, VaultRuntimeArgs } from "./vault/vault-runtime";
import { VaultPrefsStore } from "./vault/vault-prefs-store";
import { WsBus } from "./ws-bus";

// unshift: the listener must close its sockets before any service behind it, the vault flush included.
export const registerListener = (teardown: ShutdownStep[], run: ShutdownStep["run"]): void => {
  teardown.unshift(teardownStep("listener", run));
};

// push: whenever it is registered, the data dir is released only after the db behind it closes.
export const registerLockRelease = (teardown: ShutdownStep[], run: ShutdownStep["run"]): void => {
  teardown.push(teardownStep("lock", run));
};

interface ComposeDriverDeps {
  config: AppConfig;
  db: DbConnection;
  bus: WsBus;
  vault: VaultRuntime;
  connectors: ConnectorsService;
  connectorsOauth: ConnectorOauthFlow;
  folders: FoldersService;
  agentPrefs: AgentPrefsStore;
}

export interface ComposePorts {
  // a suite runs the scan inline: a worker booted from source costs every compose seconds
  knowledge?: Pick<KnowledgeRuntimeArgs, "projector">;
  openExternalUrl?: OpenExternalUrl;
  vault?: Partial<Pick<VaultRuntimeArgs, "watch" | "gitEnv" | "remote" | "spawnWatcherChannel">>;
}

export interface ComposeRuntimeArgs {
  config: AppConfig;
  version: string;
  // whether the app will answer a browser with the workspace; the caller resolved its UI dir.
  servesUi: boolean;
  // required, not defaulted: a silent default is an agent that is off.
  driver: (deps: ComposeDriverDeps) => ResolvedAgentDriver;
  cloudTransport?: CloudTransport;
  // passed in live so the caller can install its shutdown handlers before composing:
  // a ^C during a slow first boot then tears down what already exists.
  teardown?: ShutdownStep[];
  ports?: ComposePorts;
}

export interface ComposedRuntime {
  context: AppServices;
  bus: WsBus;
  db: DbConnection;
  vaultRemote: VaultRemoteProvider;
  // each step is unshifted as its resource comes up, so a boot that throws (EADDRINUSE
  // with the watcher forked and the db open) is still torn down by the caller.
  teardown: ShutdownStep[];
}

export const composeRuntime = async (args: ComposeRuntimeArgs): Promise<ComposedRuntime> => {
  const { config } = args;
  const ports = args.ports ?? {};
  const teardown = args.teardown ?? [];
  const register = (name: TeardownStepName, run: ShutdownStep["run"]): void => {
    teardown.unshift(teardownStep(name, run));
  };

  const db = createConnection(config.databasePath);
  register("db", () => {
    closeConnection(db);
  });
  const schemaVersion = getSchemaVersion(db, runMigrations(db, resolveMigrationsFolder()));

  const bus = new WsBus();
  // late-bound: the knowledge runtime needs the vault service; changes before it exists
  // are covered by the boot reconcile.
  let knowledgeRef: KnowledgeRuntime | null = null;
  const vaultRemote =
    ports.vault?.remote ??
    createVaultRemoteProvider({
      cloudUrl: config.cloudUrl,
      dataDir: config.dataDir,
      explicitRemote: config.vaultRemote,
    });
  const vaultArgs: VaultRuntimeArgs = {
    dataDir: config.dataDir,
    debugLog: debugLog(config.debug, "watcher"),
    notifier: bus,
    onFilesChanged: (change) => {
      knowledgeRef?.noteVaultChange(change);
    },
    remote: vaultRemote,
    vaultDir: config.vaultDir,
  };
  if (config.vaultSyncIntervalMs !== undefined) {
    vaultArgs.syncIntervalMs = config.vaultSyncIntervalMs;
  }
  if (ports.vault?.watch !== undefined) {
    vaultArgs.watch = ports.vault.watch;
  }
  if (ports.vault?.gitEnv !== undefined) {
    vaultArgs.gitEnv = ports.vault.gitEnv;
  }
  if (ports.vault?.spawnWatcherChannel !== undefined) {
    vaultArgs.spawnWatcherChannel = ports.vault.spawnWatcherChannel;
  }
  if (config.slowReads !== null) {
    vaultArgs.stallRead = slowReadStall(config.slowReads);
  }
  const vault = await createVaultRuntime(vaultArgs);
  const vaultPrefs = new VaultPrefsStore(config.dataDir);
  register("vault", async () => {
    await vault.dispose();
  });

  const knowledge = createKnowledgeRuntime({
    dataDir: config.dataDir,
    debugLog: debugLog(config.debug, "knowledge"),
    projector: ports.knowledge?.projector ?? createProjectionWorker(),
    vault: vault.service,
    vaultRoot: config.vaultDir,
  });
  register("knowledge", async () => {
    await knowledge.dispose();
  });
  knowledgeRef = knowledge;

  const connectorsStore = new ConnectorsStore(config.dataDir);
  const connectors = createConnectorsService(connectorsStore);
  const connectorsOauth = createConnectorOauthFlow(connectorsStore);
  const folders = createFoldersService({
    dataDir: config.dataDir,
    store: new FoldersStore(config.dataDir),
    vaultDir: config.vaultDir,
  });
  const agentPrefs = new AgentPrefsStore(config.dataDir);

  const agentDriver = args.driver({
    agentPrefs,
    bus,
    config,
    connectors,
    connectorsOauth,
    db,
    folders,
    vault,
  });
  register("agent", async () => {
    // the oauth flow serves agent sessions, so it stops with them.
    connectorsOauth.dispose();
    await agentDriver.dispose();
  });
  const agents = createAgentsService({
    accounts: agentDriver.accounts,
    env: process.env,
    store: agentPrefs,
  });

  // before the thread service, which takes the outbox hook at construction; attach() closes the other direction.
  const cloudArgs: CloudRuntimeArgs = {
    build: args.version,
    cloudUrl: config.cloudUrl,
    dataDir: config.dataDir,
    db,
    debugLog: debugLog(config.debug, "sync"),
    // the rail's one sync row reads the vault's git sync and this runtime together, so both ride one kind.
    onStatusChanged: () => {
      bus.notifyVault(["sync-status-changed"]);
    },
    // the rebase's own files-changed notification carries the applied changes to the renderer.
    onVaultPing: () => {
      void vault.syncNow();
    },
    vault: vault.service,
  };
  if (args.cloudTransport !== undefined) {
    cloudArgs.transport = args.cloudTransport;
  }
  const cloud = createCloudRuntime(cloudArgs);
  register("cloud", async () => {
    await cloud.dispose();
  });
  const threads = new ThreadService({
    createTurnDriver: agentDriver.createTurnDriver,
    db,
    notifier: bus,
    origins: createThreadOrigins(vault.service, knowledge),
    sync: cloud,
  });
  // crash recovery writes (settles turns, frees claims, enqueues), so it runs in boot order, not in the constructor.
  threads.boot();
  cloud.attach(threads);
  // off the critical path and guarded: it reads, and may write, a note per path-bound thread, and a
  // failure costs only the bindings it did not reach, which the next boot retries.
  void (async () => {
    try {
      await threads.backfillOriginNoteIds();
    } catch (error) {
      console.warn(`[threads] origin backfill skipped: ${messageOf(error)}`);
    }
  })();

  const comments = createCommentsService(vault.service, () => Math.floor(Date.now() / 1000));

  // last, once every service it announces through exists; the bus has no clients before a socket is injected.
  cloud.start();

  const context: AppServices = {
    agents,
    browserSession: createBrowserSession(),
    cloud,
    comments,
    connectors,
    connectorsOauth,
    folders,
    knowledge,
    openExternalUrl: ports.openExternalUrl ?? systemOpenExternalUrl,
    recordAgentWrites: agentDriver.recordAgentWrites,
    renameNote: async (from: string, to: string) =>
      await renameNoteWithLinkRewrite({ from, knowledge, service: vault.service, to }),
    renameTag: async (from: string, to: string) =>
      await renameTagAcrossVault({ from, knowledge, service: vault.service, to }),
    system: {
      agent: agentDriver.status,
      dataDir: config.dataDir,
      dataDirScope: config.dataDir === config.rootDataDir ? "root" : "vault",
      schemaVersion,
      servesUi: args.servesUi,
      startedAt: Date.now(),
      vaultDir: config.vaultDir,
      version: args.version,
    },
    threads,
    turnChanges: async (threadId: string) =>
      await listTurnChanges({ db, git: vault.git, threadId }),
    undoTurn: async (threadId: string, turnId: string) =>
      await undoTurnChanges({
        db,
        git: vault.git,
        knowledge,
        notifier: bus,
        service: vault.service,
        threadId,
        turnId,
      }),
    vault,
    vaultPrefs,
  };

  return { bus, context, db, teardown, vaultRemote };
};
