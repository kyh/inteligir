// reachable from the renderer's suites through `inteligir/server/testing`, so everything imported
// here compiles under the browser tsconfig: the cloud socket opener and the acp agent runtime are
// injected (`cloudTransport`, `driver`) rather than imported, and serve.ts supplies the real ones.

import { closeConnection, createConnection } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import { rebindThreadOrigins } from "@repo/db/threads";
import { resolveMigrationsFolder } from "../paths";
import type { ResolvedAgentDriver } from "./agents/agent-driver";
import { AgentPrefsStore } from "./agents/agent-prefs-store";
import { createAgentsService } from "./agents/agents-service";
import { migrateLegacyCommentSidecars } from "./comments/comments-migration";
import { createCommentsService } from "./comments/comments-service";
import { systemOpenExternalUrl } from "./cloud/browser-opener";
import type { OpenExternalUrl } from "./cloud/browser-opener";
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
import { createFoldersService } from "./folders/folders-service";
import type { FoldersService } from "./folders/folders-service";
import { FoldersStore } from "./folders/folders-store";
import { createKnowledgeRuntime } from "./knowledge/knowledge-runtime";
import type { KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { renameNoteWithLinkRewrite } from "./knowledge/rename";
import { renameTagAcrossVault } from "./knowledge/rename-tag";
import type { AppServices } from "./orpc";
import { teardownStep } from "./shutdown";
import type { ShutdownStep, TeardownStepName } from "./shutdown";
import { ThreadService } from "./threads/service";
import { createVaultRuntime } from "./vault/vault-runtime";
import type { VaultRuntime, VaultRuntimeArgs } from "./vault/vault-runtime";
import { VaultPrefsStore } from "./vault/vault-prefs-store";
import { createScriptedVoiceService } from "./voice/scripted-voice-service";
import { ParakeetVoiceService } from "./voice/voice-service";
import type { VoiceService } from "./voice/voice-service";
import { VoiceStreamHub } from "./voice/voice-stream-hub";
import { WsBus } from "./ws-bus";

// unshift: the listener must close its sockets before any service behind it, the vault flush included.
export const registerListener = (teardown: ShutdownStep[], run: ShutdownStep["run"]): void => {
  teardown.unshift(teardownStep("listener", run));
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
  openExternalUrl?: OpenExternalUrl;
  vault?: Pick<VaultRuntimeArgs, "watch" | "gitEnv" | "remote">;
}

export interface ComposeRuntimeArgs {
  config: AppConfig;
  version: string;
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
  voiceStreamHub: VoiceStreamHub;
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
  const vault = await createVaultRuntime(vaultArgs);
  const vaultPrefs = new VaultPrefsStore(config.dataDir);
  register("vault", async () => {
    await vault.dispose();
  });

  const knowledge = createKnowledgeRuntime({
    dataDir: config.dataDir,
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
  const agents = createAgentsService({ env: process.env, store: agentPrefs });

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

  // before the thread service, which takes the outbox hook at construction; attach() closes the other direction.
  const cloudArgs: CloudRuntimeArgs = {
    cloudUrl: config.cloudUrl,
    dataDir: config.dataDir,
    db,
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
    sync: cloud,
  });
  // crash recovery writes (settles turns, frees claims, enqueues), so it runs in boot order, not in the constructor.
  threads.boot();
  cloud.attach(threads);

  // scripted answers `ready` with no model and no native binding, so the scenario suite
  // drives everything above the decode for real.
  const voice: VoiceService =
    config.voice === "scripted"
      ? createScriptedVoiceService()
      : new ParakeetVoiceService({ modelDir: config.modelDir });
  register("voice", async () => {
    await voice.dispose();
  });
  const voiceStreamHub = new VoiceStreamHub(voice);

  const comments = createCommentsService(vault.service, () => Math.floor(Date.now() / 1000));
  await migrateLegacyCommentSidecars({
    comments,
    vault: vault.service,
    warn: (message) => {
      console.warn(`[comments] ${message}`);
    },
  });

  // last, once every service it announces through exists; the bus has no clients before a socket is injected.
  cloud.start();

  const context: AppServices = {
    agents,
    cloud,
    comments,
    connectors,
    connectorsOauth,
    folders,
    knowledge,
    openExternalUrl: ports.openExternalUrl ?? systemOpenExternalUrl,
    renameNote: async (from: string, to: string) =>
      await renameNoteWithLinkRewrite({
        from,
        knowledge,
        rebindThreads: (movedFrom, movedTo) => {
          rebindThreadOrigins(db, bus, { from: movedFrom, to: movedTo });
        },
        service: vault.service,
        to,
      }),
    renameTag: async (from: string, to: string) =>
      await renameTagAcrossVault({ from, knowledge, service: vault.service, to }),
    system: {
      agent: agentDriver.status,
      dataDir: config.dataDir,
      dataDirScope: config.dataDir === config.rootDataDir ? "root" : "vault",
      schemaVersion,
      startedAt: Date.now(),
      vaultDir: config.vaultDir,
      version: args.version,
    },
    threads,
    vault,
    vaultPrefs,
    voice,
  };

  return { bus, context, db, teardown, vaultRemote, voiceStreamHub };
};
