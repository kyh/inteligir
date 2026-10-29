// reachable from the workspace UI's suites (src/workspace/), so everything imported here
// compiles under their DOM tsconfig: the cloud socket opener, the acp agent runtime and the
// vendor account probe are injected (`cloudTransport`, `driver`, `accounts`) rather than imported,
// and serve.ts supplies the real ones.

import { randomBytes } from "node:crypto";
import { closeConnection } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import type { ExternalSync } from "@repo/contract/local/vault/vault-schema";
import type { ResolvedAgentDriver } from "./agents/agent-driver";
import { AgentPrefsStore } from "./agents/agent-prefs-store";
import type { AgentAccounts } from "./agents/agent-sign-in";
import { createAgentsService } from "./agents/agents-service";
import { createBrowserSession } from "./browser-session";
import { createAnnotationsService } from "./annotations/annotations-service";
import { createCloudRuntime } from "./cloud/sync-runtime";
import type { CloudRuntime, CloudRuntimeArgs, CloudTransport } from "./cloud/sync-runtime";
import { createVaultRemoteProvider } from "./cloud/vault-remote";
import type { AppConfig } from "./config";
import { createConnectorsService, createVendorMcpConfigs } from "./connectors/connectors-service";
import type { VendorMcpConfigs } from "./connectors/vendor-mcp-config";
import { debugLog } from "./debug-log";
import { deviceNameReader, readMachineName } from "./device-name";
import { messageOf } from "./error-message";
import { createImportService } from "./imports/import-service";
import type { CapturePorts } from "./items/capture/capture-ports";
import { createItemsService } from "./items/items-service";
import type { ItemsService } from "./items/items-service";
import { createKnowledgeRuntime } from "./knowledge/knowledge-runtime";
import type { KnowledgeRuntime, KnowledgeRuntimeArgs } from "./knowledge/knowledge-runtime";
import { createProjectionWorker } from "./knowledge/projector";
import { createImageDownscale } from "./media/image-downscale";
import { renameNoteWithLinkRewrite } from "./knowledge/rename";
import { renameTagAcrossVault } from "./knowledge/rename-tag";
import { openDatabase } from "./open-database";
import type { AppServices } from "./orpc";
import { addTeardownStep } from "./shutdown";
import type { ShutdownStep } from "./shutdown";
import { ThreadService } from "./threads/service";
import { createThreadOrigins } from "./threads/thread-origins";
import type { ProviderEventSink } from "./threads/turn-driver";
import { createTurnUndo } from "./threads/turn-undo";
import { folderExternalSync } from "./vault/folder-facts";
import { processGit } from "./vault/git-run";
import { slowReadStall } from "./vault/slow-reads";
import { createVaultRuntime } from "./vault/vault-runtime";
import type { VaultRuntime, VaultRuntimeArgs } from "./vault/vault-runtime";
import { VaultPrefsStore } from "./vault/vault-prefs-store";
import { WsBus } from "./ws-bus";

interface ComposeDriverDeps {
  config: AppConfig;
  db: DbConnection;
  bus: WsBus;
  vault: VaultRuntime;
  agentPrefs: AgentPrefsStore;
  sink: ProviderEventSink;
  // the scripted driver's save, run inside its turn as an agent's shell would run `inteligir save`
  items: Pick<ItemsService, "saveLink" | "saveFile">;
}

export interface ComposePorts {
  // a suite runs the scan inline: a worker booted from source costs every compose seconds
  // a suite's inline projector, and the read deadline it stalls a doc past
  knowledge?: Pick<KnowledgeRuntimeArgs, "projector" | "readDeadlineMs">;
  // a suite's vendor configs live under its own temp dir; unset, each vendor's own on this Mac.
  connectors?: VendorMcpConfigs;
  // what this device is called before any sign-in names it; unset, the machine's own name.
  machineName?: string;
  // a suite's read stall, which it lets go of itself; unset, INTELIGIR_SLOW_READS' fixed delay
  vault?: Partial<Pick<VaultRuntimeArgs, "watch" | "git" | "remote" | "stallRead">>;
  // a suite's fetcher, lookup and clock for the capture; passed through untouched
  items?: CapturePorts;
}

export interface ComposeRuntimeArgs {
  config: AppConfig;
  version: string;
  // whether the app will answer a browser with the workspace; the caller resolved its UI dir.
  servesUi: boolean;
  // required, not defaulted: a silent default is an agent that is off.
  driver: (deps: ComposeDriverDeps) => ResolvedAgentDriver;
  accounts: AgentAccounts;
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
  // the service that syncs the vault's folder instead, which withholds the hosted vault
  externalSync: ExternalSync | null;
  // each step is added as its resource comes up, so a boot that throws (EADDRINUSE
  // with the watcher forked and the db open) is still torn down by the caller.
  teardown: ShutdownStep[];
  // serve.ts calls it once the port is bound: a fill refuses this server's own address
  setOwnPort: (port: number) => void;
}

export const composeRuntime = async (args: ComposeRuntimeArgs): Promise<ComposedRuntime> => {
  const { config } = args;
  const ports = args.ports ?? {};
  const teardown = args.teardown ?? [];

  const { db, schemaVersion } = openDatabase(config);
  addTeardownStep(teardown, "db", () => {
    closeConnection(db);
  });

  const bus = new WsBus();
  // late-bound: the knowledge runtime needs the vault service; changes before it exists
  // are covered by the boot reconcile.
  let knowledgeRef: KnowledgeRuntime | null = null;
  // built after the vault, which asks it only from a sync tick, long after both exist.
  let cloudRef: CloudRuntime | null = null;
  // once: a folder does not move under a running server.
  const externalSync = folderExternalSync(config.vaultDir, config.homeDir);
  const vaultRemote =
    ports.vault?.remote ??
    createVaultRemoteProvider({
      build: { platform: "desktop", version: args.version },
      cloudUrl: config.cloudUrl,
      dataDir: config.dataDir,
      externalSync,
      pinnedRemote: config.vaultRemote,
    });
  const machineName = ports.machineName ?? (await readMachineName());
  const vaultArgs: VaultRuntimeArgs = {
    accountPingsReach: () => cloudRef?.pingsReach() ?? false,
    dataDir: config.dataDir,
    debugLog: debugLog(config.debug, "watcher"),
    deviceName: deviceNameReader(config.dataDir, machineName),
    externalSync,
    git: ports.vault?.git ?? processGit,
    notifier: bus,
    onFilesChanged: (change) => {
      knowledgeRef?.invalidate(change);
    },
    remote: vaultRemote,
    stallRead:
      ports.vault?.stallRead ??
      (config.slowReads === null ? undefined : slowReadStall(config.slowReads)),
    syncIntervalMs: config.vaultSyncIntervalMs,
    vaultDir: config.vaultDir,
    watch: ports.vault?.watch,
  };
  const vault = await createVaultRuntime(vaultArgs);
  const vaultPrefs = new VaultPrefsStore(config.dataDir);
  addTeardownStep(teardown, "vault", async () => {
    await vault.dispose();
  });

  const knowledge = createKnowledgeRuntime({
    attachmentsFolder: () => {
      const { attachments } = vaultPrefs.read();
      return attachments?.kind === "folder" ? attachments.path : null;
    },
    dataDir: config.dataDir,
    debugLog: debugLog(config.debug, "knowledge"),
    // a body edit, every fill's and every keystroke's, moves no link target, so it says nothing
    onTargetsChanged: () => {
      bus.notifyVault(["targets-changed"]);
    },
    projector: ports.knowledge?.projector ?? createProjectionWorker(),
    readDeadlineMs: ports.knowledge?.readDeadlineMs,
    vault: vault.service,
    vaultRoot: config.vaultDir,
  });
  addTeardownStep(teardown, "knowledge", async () => {
    await knowledge.dispose();
  });
  knowledgeRef = knowledge;

  const annotations = createAnnotationsService({
    knowledge,
    now: () => Math.floor(Date.now() / 1000),
    service: vault.service,
  });
  const downscale = createImageDownscale({ platform: process.platform });
  // unset until serve.ts has bound the port, and a booted suite's app is never bound
  let ownPortRef: number | null = null;
  // before the agent driver, which the scripted one takes
  const items = createItemsService({
    annotations,
    dataDir: config.dataDir,
    db,
    debugLog: debugLog(config.debug, "items"),
    downscale,
    git: vault.git,
    knowledge,
    newId: () => crypto.randomUUID(),
    now: () => new Date(),
    ownPort: () => ownPortRef,
    ports: ports.items,
    prefs: vaultPrefs,
    renameNote: async (from, to) =>
      await renameNoteWithLinkRewrite({
        alias: false,
        from,
        knowledge,
        service: vault.service,
        to,
      }),
    service: vault.service,
    version: args.version,
  });
  addTeardownStep(teardown, "items", async () => {
    await items.dispose();
  });
  const imports = createImportService({
    annotations,
    core: items.core,
    dataDir: config.dataDir,
    git: vault.git,
    items,
    newId: () => crypto.randomUUID(),
    notify: () => {
      bus.notifyVault(["import-changed"]);
    },
    now: () => new Date(),
  });
  addTeardownStep(teardown, "imports", async () => {
    await imports.dispose();
  });

  const agentPrefs = new AgentPrefsStore(config.dataDir);
  const connectors = createConnectorsService({
    configs: ports.connectors ?? createVendorMcpConfigs({ cwd: config.dataDir, env: process.env }),
    defaultHarness: () => agentPrefs.defaultHarness(),
  });
  addTeardownStep(teardown, "connectors", async () => {
    await connectors.dispose();
  });

  const agents = createAgentsService({
    accounts: args.accounts,
    env: process.env,
    store: agentPrefs,
  });

  const cloudArgs: CloudRuntimeArgs = {
    build: args.version,
    cloudUrl: config.cloudUrl,
    dataDir: config.dataDir,
    debugLog: debugLog(config.debug, "sync"),
    machineName,
    // the rail's one sync row reads the vault's git sync and this runtime together, so both ride one kind.
    onStatusChanged: () => {
      bus.notifyVault(["sync-status-changed"]);
    },
    // the rebase's own files-changed notification carries the applied changes to the page.
    onVaultPing: () => {
      void vault.git.syncNow();
    },
  };
  if (args.cloudTransport !== undefined) {
    cloudArgs.transport = args.cloudTransport;
  }
  const cloud = createCloudRuntime(cloudArgs);
  cloudRef = cloud;
  addTeardownStep(teardown, "cloud", async () => {
    await cloud.dispose();
  });
  const threads = new ThreadService({
    db,
    notifier: bus,
    origins: createThreadOrigins(vault.service, knowledge),
  });
  const { driver: turnDriver, status: agentStatus } = args.driver({
    agentPrefs,
    bus,
    config,
    db,
    items,
    sink: threads,
    vault,
  });
  threads.attachDriver(turnDriver);
  addTeardownStep(teardown, "agent", async () => {
    await args.accounts.dispose();
    await turnDriver.dispose?.();
  });
  // crash recovery writes (settles turns, frees claims, enqueues), so it runs in boot order, not in the constructor.
  threads.boot();
  // off the critical path and guarded: it reads, and may write, a note per path-bound thread, and a
  // failure costs only the bindings it did not reach, which the next boot retries.
  void (async () => {
    try {
      await threads.repairPathOnlyOrigins();
    } catch (error) {
      console.warn(`[threads] origin repair skipped: ${messageOf(error)}`);
    }
  })();
  // off the critical path too: a pending fill or a stopped import is picked up where it was left
  try {
    items.boot();
    imports.boot();
  } catch (error) {
    console.warn(`[items] boot skipped: ${messageOf(error)}`);
  }

  // last, once every service it announces through exists; the bus has no clients before a socket is injected.
  cloud.start();

  const context: AppServices = {
    agents,
    annotations,
    browserSession: createBrowserSession(),
    cloud,
    connectors,
    downscale,
    imports,
    items,
    knowledge,
    recordAgentWrites: (threadId, paths) => {
      turnDriver.recordAgentWrites?.(threadId, paths);
    },
    renameNote: async (from: string, to: string) =>
      await renameNoteWithLinkRewrite({ from, knowledge, service: vault.service, to }),
    renameTag: async (from: string, to: string) =>
      await renameTagAcrossVault({ from, knowledge, service: vault.service, to }),
    system: {
      agent: agentStatus,
      dataDir: config.dataDir,
      // distinct from the cookie's secret, and per boot like it: it rides byte-route urls, so it
      // is no credential alone (requireMediaRequest in app.ts)
      mediaToken: randomBytes(32).toString("base64url"),
      schemaVersion,
      servesUi: args.servesUi,
      startedAt: Date.now(),
      vaultDir: config.vaultDir,
      version: args.version,
    },
    threads,
    turnUndo: createTurnUndo({
      db,
      git: vault.git,
      knowledge,
      notifier: bus,
      service: vault.service,
    }),
    vault,
    vaultPrefs,
  };

  return {
    bus,
    context,
    db,
    externalSync,
    setOwnPort: (port) => {
      ownPortRef = port;
    },
    teardown,
  };
};
