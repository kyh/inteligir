// THE COMPOSITION ROOT: every service `inteligir serve` runs, constructed in
// boot order in ONE function and returned as a VALUE — the typed context the
// routes are wired over (`app.ts`), and the ordered teardown the shutdown
// sequence runs. `serve.ts` adds only what needs a bound port (the listener
// step); `__tests__/boot-app.ts` calls the same function with hermetic ports,
// so the production graph and the suites' graph cannot diverge.
//
// Two dials are INJECTED rather than imported here, and the reason is the
// same for both: the renderer's booted suites reach this module through
// `inteligir/server/testing`, so everything imported here is compiled by the
// browser tsconfig and loaded into every one of those suites. The cloud
// socket opener must stay out of that graph (`cloud/cloud-socket.ts` states
// why), and the ACP agent runtime is the heavyweight the page's suites must
// not load — so `driver` is a required argument, and `serve.ts` is the one
// place that supplies the real resolver.

import { closeConnection, createConnection, type DbConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import { rebindThreadOrigins } from "@repo/db/threads";
import { resolveMigrationsFolder } from "../paths";
import type { ResolvedAgentDriver } from "./agents/agent-driver";
import { binaryOnPath } from "./agents/binary-on-path";
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
import { createConnectorsStore } from "./connectors/connectors-store";
import { createConnectorOauthFlow, type ConnectorOauthFlow } from "./connectors/oauth-flow";
import { createFoldersService, type FoldersService } from "./folders/folders-service";
import { createFoldersStore } from "./folders/folders-store";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { renameNoteWithLinkRewrite } from "./knowledge/rename";
import { createCliInferenceRunner, INFERENCE_BINARY } from "./note-intelligence/infer";
import {
  createNoteIntelligence,
  type NoteIntelligence,
  type NoteIntelligenceDeps,
} from "./note-intelligence/note-intelligence";
import { createNoteIntelligenceSettingsStore } from "./note-intelligence/settings-store";
import type { AppContext } from "./orpc";
import { TEARDOWN_BUDGETS_MS, type ShutdownStep, type TeardownStepName } from "./shutdown";
import { ThreadService } from "./threads/service";
import {
  createVaultRuntime,
  type VaultRuntime,
  type VaultRuntimeArgs,
} from "./vault/vault-runtime";
import {
  ParakeetVoiceService,
  ScriptedVoiceService,
  type VoiceService,
} from "./voice/voice-service";
import { VoiceStreamHub } from "./voice/voice-stream-hub";
import { WsBus } from "./ws-bus";

/** Everything a handler reaches — the oRPC context minus the one per-request
 *  value (`requestHost`), which only a live request can supply. */
export type AppServices = Omit<AppContext, "requestHost">;

/** A step with the budget its name is assigned in the one budgets table, so a
 *  step cannot arrive carrying a number of its own. */
export function teardownStep(name: TeardownStepName, run: () => Promise<void>): ShutdownStep {
  return { name, timeoutMs: TEARDOWN_BUDGETS_MS[name], run };
}

interface ComposeDriverDeps {
  config: AppConfig;
  db: DbConnection;
  bus: WsBus;
  vault: VaultRuntime;
  connectors: ConnectorsService;
  connectorsOauth: ConnectorOauthFlow;
  folders: FoldersService;
}

/** The hermetic seams a suite injects; production passes none of these. */
export interface ComposePorts {
  /** A pairing must not pop a window on whoever ran the suite. */
  openExternalUrl?: OpenExternalUrl;
  /** The availability probe and the inference child, without a vendor CLI. */
  inference?: Pick<NoteIntelligenceDeps, "availability" | "infer">;
  /** No watcher fork, hermetic git, no remote. */
  vault?: Pick<VaultRuntimeArgs, "watch" | "gitEnv" | "remote">;
}

export interface ComposeRuntimeArgs {
  config: AppConfig;
  /** What the availability probes read; the config layer already resolved
   *  everything else out of it. */
  env: NodeJS.ProcessEnv;
  version: string;
  /**
   * Which agent driver boots, given the services that exist by then. Required
   * rather than defaulted — see the header for why the real resolver cannot
   * be imported here, and a silent default would be an agent that is off.
   */
  driver: (deps: ComposeDriverDeps) => ResolvedAgentDriver;
  /** The sync loop's wire. Absent, the runtime dials its own fetch and stays
   *  poll-only — the socket opener can only arrive by injection. */
  cloudTransport?: CloudTransport;
  /**
   * The caller's LIVE steps array, filled here as the boot proceeds. Passed in
   * rather than created so the caller can install its shutdown handlers over
   * it BEFORE composing: a ^C during a slow first boot (a cold vault
   * reconcile, a clone) then tears down what already exists instead of being
   * ignored. Absent, a fresh array is created — the returned value either way.
   */
  teardown?: ShutdownStep[];
  ports?: ComposePorts;
}

export interface ComposedRuntime {
  /** What `createApp` wires the routes over. */
  context: AppServices;
  bus: WsBus;
  db: DbConnection;
  voiceStreamHub: VoiceStreamHub;
  /** Where the vault's remote comes from, re-read per pass; the boot log's
   *  one read lives in serve.ts. */
  vaultRemote: VaultRemoteProvider;
  /**
   * The ordered teardown, in the budgets table's order minus `listener` —
   * which only the caller that binds a port can register, by unshifting it
   * onto this array. Each step was registered the moment its resource came
   * up (unshift, so reversing creation yields the teardown order shutdown.ts
   * states), which is what makes a FAILED boot survivable: a listen that
   * throws EADDRINUSE still has a vault watcher forked and a database open,
   * and the caller's shutdown over this array is what releases both.
   */
  teardown: ShutdownStep[];
}

/** Every service, boot-ordered: db → vault → knowledge → intelligence →
 *  agent → cloud/threads/comments → voice. No listen, no process, no signals. */
export async function composeRuntime(args: ComposeRuntimeArgs): Promise<ComposedRuntime> {
  const { config, env } = args;
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
  // The knowledge runtime needs the vault service the runtime hands back, so
  // the hook late-binds; changes before it exists are covered by the boot
  // reconcile the first pass always runs.
  let knowledgeRef: KnowledgeRuntime | null = null;
  let noteIntelligenceRef: NoteIntelligence | null = null;
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
      noteIntelligenceRef?.noteVaultChange();
    },
  };
  if (config.vaultSyncIntervalMs !== undefined) {
    vaultArgs.syncIntervalMs = config.vaultSyncIntervalMs;
  }
  if (ports.vault?.watch !== undefined) vaultArgs.watch = ports.vault.watch;
  if (ports.vault?.gitEnv !== undefined) vaultArgs.gitEnv = ports.vault.gitEnv;
  const vault = await createVaultRuntime(vaultArgs);
  register("vault", () => vault.dispose());

  const knowledge = createKnowledgeRuntime({
    dataDir: config.dataDir,
    vault: vault.service,
    vaultRoot: config.vaultDir,
  });
  register("knowledge", () => knowledge.dispose());
  knowledgeRef = knowledge;

  // The connectors registry: ONE service, consumed twice — the routes edit it,
  // session launch composes its enabled rows into every harness's mcpServers.
  const connectorsStore = createConnectorsStore(config.dataDir);
  const connectors = createConnectorsService(connectorsStore);
  // The OAuth dance for hosted rows: the pairing discipline over the same
  // store — one pending slot, tokens landing beside the row.
  const connectorsOauth = createConnectorOauthFlow(connectorsStore);
  // Connected Folders: reference dirs sessions are told about — an affordance
  // and an instructions line, never a permission grant.
  const folders = createFoldersService({
    store: createFoldersStore(config.dataDir),
    vaultDir: config.vaultDir,
    dataDir: config.dataDir,
  });

  // Note Intelligence: OFF until the Settings toggle turns it on; the
  // files-changed hook above only ever schedules, never spawns, while
  // disabled. The PATH probe is the agent driver's, one spelling
  // (`binaryOnPath`) — an install without the vendor CLI says so in status
  // rather than spawning a command that is not there once per note.
  const inference = ports.inference ?? {
    availability:
      binaryOnPath(INFERENCE_BINARY, env) === null
        ? {
            kind: "unavailable",
            detail: `\`${INFERENCE_BINARY}\` was not found on PATH — note intelligence infers fields by running it.`,
          }
        : { kind: "available" },
    infer: createCliInferenceRunner({ cwd: config.dataDir }),
  };
  const noteIntelligence = createNoteIntelligence({
    availability: inference.availability,
    infer: inference.infer,
    settings: createNoteIntelligenceSettingsStore(config.dataDir),
    vault: vault.service,
    onLog: (message) => {
      console.error(message);
    },
  });
  register("intelligence", async () => {
    noteIntelligence.dispose();
  });
  noteIntelligenceRef = noteIntelligence;

  const agentDriver = args.driver({
    config,
    db,
    bus,
    vault,
    connectors,
    connectorsOauth,
    folders,
  });
  register("agent", () => {
    // The oauth flow serves agent sessions; it stops when they do — a
    // callback landing after this exchanges nothing and writes nothing.
    connectorsOauth.dispose();
    return agentDriver.dispose();
  });

  // Built BEFORE the thread service, which needs its outbox hook at
  // construction; the ingest sink goes back the other way once that service
  // exists. An install with no credential in its data dir starts nothing here.
  const cloudArgs: CloudRuntimeArgs = {
    db,
    dataDir: config.dataDir,
    cloudUrl: config.cloudUrl,
    vault: vault.service,
    // Another device pushed vault bytes (or a pairing just completed): run a
    // vault sync pass. The rebase's consolidated files-changed notification
    // then carries the applied changes to the renderer on its own.
    onVaultPing: () => {
      void vault.syncNow();
    },
  };
  if (args.cloudTransport !== undefined) cloudArgs.transport = args.cloudTransport;
  if (ports.openExternalUrl !== undefined) cloudArgs.openExternalUrl = ports.openExternalUrl;
  const cloud = createCloudRuntime(cloudArgs);
  register("cloud", () => cloud.dispose());
  const threads = new ThreadService({
    db,
    notifier: bus,
    createTurnDriver: agentDriver.createTurnDriver,
    sync: cloud,
  });
  cloud.attach(threads);

  // `scripted` is selected by INTELIGIR_VOICE and is the whole reason the
  // scenario suite can drive a microphone: it answers `ready` with no model on
  // disk and no native binding loaded, so everything ABOVE the decode — the
  // permission, the capture, the wire, the composer insertion — is real.
  const voice: VoiceService =
    config.voice === "scripted"
      ? new ScriptedVoiceService()
      : new ParakeetVoiceService({ modelDir: config.modelDir });
  register("voice", () => voice.dispose());
  const voiceStreamHub = new VoiceStreamHub(voice);

  // Everything a handler can reach, built once. The comments sidecar rides the
  // vault service, so containment, the watcher ping, auto-commit and sync come
  // with it; its timestamps are unix seconds minted at this boundary.
  const context: AppServices = {
    cloud,
    comments: createCommentsService(vault.service, () => Math.floor(Date.now() / 1000)),
    connectors,
    connectorsOauth,
    folders,
    knowledge,
    noteIntelligence,
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
    voice,
  };

  return { context, bus, db, voiceStreamHub, vaultRemote, teardown };
}
