// reachable from the renderer's suites through `inteligir/server/testing`, so everything imported
// here compiles under the browser tsconfig: the cloud socket opener and the acp agent runtime are
// injected (`cloudTransport`, `driver`) rather than imported, and serve.ts supplies the real ones.

import { closeConnection, createConnection, type DbConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import { rebindThreadOrigins } from "@repo/db/threads";
import { resolveMigrationsFolder } from "../paths";
import type { ResolvedAgentDriver } from "./agents/agent-driver";
import { AgentPrefsStore } from "./agents/agent-prefs-store";
import { createAgentsService } from "./agents/agents-service";
import { createCommentsService } from "./comments/comments-service";
import { systemOpenExternalUrl, type OpenExternalUrl } from "./cloud/browser-opener";
import {
  createCloudRuntime,
  type CloudRuntimeArgs,
  type CloudTransport,
} from "./cloud/sync-runtime";
import { createVaultRemoteProvider, type VaultRemoteProvider } from "./cloud/vault-remote";
import type { AppConfig } from "./config";
import { createConnectorsService, type ConnectorsService } from "./connectors/connectors-service";
import { ConnectorsStore } from "./connectors/connectors-store";
import { createConnectorOauthFlow, type ConnectorOauthFlow } from "./connectors/oauth-flow";
import { createFoldersService, type FoldersService } from "./folders/folders-service";
import { FoldersStore } from "./folders/folders-store";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { renameNoteWithLinkRewrite } from "./knowledge/rename";
import { renameTagAcrossVault } from "./knowledge/rename-tag";
import type { AppServices } from "./orpc";
import { teardownStep, type ShutdownStep, type TeardownStepName } from "./shutdown";
import { ThreadService } from "./threads/service";
import {
  createVaultRuntime,
  type VaultRuntime,
  type VaultRuntimeArgs,
} from "./vault/vault-runtime";
import { VaultPrefsStore } from "./vault/vault-prefs-store";
import {
  ParakeetVoiceService,
  ScriptedVoiceService,
  type VoiceService,
} from "./voice/voice-service";
import { VoiceStreamHub } from "./voice/voice-stream-hub";
import { WsBus } from "./ws-bus";

// unshift: the listener must close its sockets before any service behind it, the vault flush included.
export function registerListener(teardown: ShutdownStep[], run: () => Promise<void>): void {
  teardown.unshift(teardownStep("listener", run));
}

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

export async function composeRuntime(args: ComposeRuntimeArgs): Promise<ComposedRuntime> {
  const { config } = args;
  const ports = args.ports ?? {};
  const teardown = args.teardown ?? [];
  const register = (name: TeardownStepName, run: () => Promise<void>): void => {
    teardown.unshift(teardownStep(name, run));
  };

  const db = createConnection(config.databasePath);
  register("db", async () => {
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
      explicitRemote: config.vaultRemote,
      cloudUrl: config.cloudUrl,
      dataDir: config.dataDir,
    });
  const vaultArgs: VaultRuntimeArgs = {
    vaultDir: config.vaultDir,
    remote: vaultRemote,
    dataDir: config.dataDir,
    notifier: bus,
    onFilesChanged: (change) => {
      knowledgeRef?.noteVaultChange(change);
    },
  };
  if (config.vaultSyncIntervalMs !== undefined) {
    vaultArgs.syncIntervalMs = config.vaultSyncIntervalMs;
  }
  if (ports.vault?.watch !== undefined) vaultArgs.watch = ports.vault.watch;
  if (ports.vault?.gitEnv !== undefined) vaultArgs.gitEnv = ports.vault.gitEnv;
  const vault = await createVaultRuntime(vaultArgs);
  const vaultPrefs = new VaultPrefsStore(config.dataDir);
  register("vault", () => vault.dispose());

  const knowledge = createKnowledgeRuntime({
    dataDir: config.dataDir,
    vault: vault.service,
    vaultRoot: config.vaultDir,
  });
  register("knowledge", () => knowledge.dispose());
  knowledgeRef = knowledge;

  const connectorsStore = new ConnectorsStore(config.dataDir);
  const connectors = createConnectorsService(connectorsStore);
  const connectorsOauth = createConnectorOauthFlow(connectorsStore);
  const folders = createFoldersService({
    store: new FoldersStore(config.dataDir),
    vaultDir: config.vaultDir,
    dataDir: config.dataDir,
  });
  const agentPrefs = new AgentPrefsStore(config.dataDir);
  const agents = createAgentsService({ store: agentPrefs, env: process.env });

  const agentDriver = args.driver({
    config,
    db,
    bus,
    vault,
    connectors,
    connectorsOauth,
    folders,
    agentPrefs,
  });
  register("agent", () => {
    // the oauth flow serves agent sessions, so it stops with them.
    connectorsOauth.dispose();
    return agentDriver.dispose();
  });

  // before the thread service, which takes the outbox hook at construction; attach() closes the other direction.
  const cloudArgs: CloudRuntimeArgs = {
    db,
    dataDir: config.dataDir,
    cloudUrl: config.cloudUrl,
    vault: vault.service,
    // the rebase's own files-changed notification carries the applied changes to the renderer.
    onVaultPing: () => {
      void vault.syncNow();
    },
  };
  if (args.cloudTransport !== undefined) cloudArgs.transport = args.cloudTransport;
  const cloud = createCloudRuntime(cloudArgs);
  register("cloud", () => cloud.dispose());
  const threads = new ThreadService({
    db,
    notifier: bus,
    createTurnDriver: agentDriver.createTurnDriver,
    sync: cloud,
  });
  // crash recovery writes (settles turns, frees claims, enqueues), so it runs in boot order, not in the constructor.
  threads.boot();
  cloud.attach(threads);

  // scripted answers `ready` with no model and no native binding, so the scenario suite
  // drives everything above the decode for real.
  const voice: VoiceService =
    config.voice === "scripted"
      ? new ScriptedVoiceService()
      : new ParakeetVoiceService({ modelDir: config.modelDir });
  register("voice", () => voice.dispose());
  const voiceStreamHub = new VoiceStreamHub(voice);

  // last, once every service it announces through exists; the bus has no clients before a socket is injected.
  cloud.start();

  const context: AppServices = {
    agents,
    cloud,
    comments: createCommentsService(vault.service, () => Math.floor(Date.now() / 1000)),
    connectors,
    connectorsOauth,
    folders,
    knowledge,
    openExternalUrl: ports.openExternalUrl ?? systemOpenExternalUrl,
    renameNote: (from: string, to: string) =>
      renameNoteWithLinkRewrite({
        service: vault.service,
        knowledge,
        rebindThreads: (movedFrom, movedTo) =>
          rebindThreadOrigins(db, bus, { from: movedFrom, to: movedTo }),
        from,
        to,
      }),
    renameTag: (from: string, to: string) =>
      renameTagAcrossVault({ service: vault.service, knowledge, from, to }),
    system: {
      version: args.version,
      dataDir: config.dataDir,
      vaultDir: config.vaultDir,
      schemaVersion,
      startedAt: Date.now(),
      agent: agentDriver.status,
    },
    threads,
    vault,
    vaultPrefs,
    voice,
  };

  return { context, bus, db, voiceStreamHub, vaultRemote, teardown };
}
