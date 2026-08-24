// `inteligir serve` — the whole local server, in the process that ran the
// command. Boot order: config → db open+migrate → createApp → serve →
// injectWebSocket.
//
// IN-PROCESS, not supervised, and the reason is the failure this shape has: a
// boot that throws. A supervisor around a single child would buy
// restart-on-crash and pay for it with a PID file, a health poll, a
// signal-forwarding path and two places for the exit code to come from, none
// of which helps that. One process, one exit code, and ^C reaching the code
// that owns the vault directly. (The Electron shell is the opposite case and
// forks a utilityProcess, because there the server is a child of a UI process
// that must outlive it.)

import { mkdirSync } from "node:fs";
import { closeConnection, createConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import { resolveMigrationsFolder, resolveUiDir } from "../paths";
import { resolveAgentDriver } from "./agent/agent-driver";
import { createConnectorsService } from "./connectors/connectors-service";
import { createConnectorOauthFlow } from "./connectors/oauth-flow";
import { composeSessionMcpServers } from "./connectors/session-servers";
import { createCliInferenceRunner } from "./note-intelligence/infer";
import {
  createNoteIntelligence,
  type NoteIntelligence,
} from "./note-intelligence/note-intelligence";
import { createNoteIntelligenceSettingsStore } from "./note-intelligence/settings-store";
import { createConnectorsStore } from "./connectors/connectors-store";
import { createFoldersService } from "./folders/folders-service";
import { createFoldersStore } from "./folders/folders-store";
import {
  buildAgentShellEnv,
  resolveCliBinDir,
  withConnectedDirs,
  type AgentShellEnv,
} from "./agent/agent-shell-env";
import { createApp, type AppUi } from "./app";
import { openCloudSocket } from "./cloud/cloud-socket";
import { resolveAppConfig, resolveCheckoutRoot } from "./config";
import { ensureDevDataDirOwnership } from "./data-dir";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { closeServer, listenWithRetry, type UpgradedSockets } from "./listen";
import { mintServerToken, removeServerFile, writeServerFile } from "./server-file";
import { createTurnProposalCapture } from "./proposals/turn-proposals";
import {
  createGracefulShutdown,
  installFatalErrorHandlers,
  installShutdownSignals,
  TEARDOWN_BUDGETS_MS,
  type ShutdownStep,
  type TeardownStepName,
} from "./shutdown";
import { redactRemoteUrl } from "./vault/git";
import { createVaultRuntime, type VaultRuntimeArgs } from "./vault/vault-runtime";
import { WsBus } from "./ws-bus";

/**
 * The teardown, accumulated AS THE BOOT PROCEEDS.
 *
 * `unshift` rather than `push`, and the two orders coincide on purpose:
 * resources come up db → vault → knowledge → intelligence → agent → cloud →
 * voice → listener,
 * so reversing creation yields exactly the teardown order shutdown.ts states
 * (listener → voice → cloud → agent → intelligence → knowledge → vault → db).
 * Registering each step
 * the moment its resource exists is also what makes a FAILED boot survivable:
 * a listen that
 * throws EADDRINUSE still has a vault watcher forked and a database open, and
 * without this the process would sit there holding both, alive on the
 * watcher's IPC channel and listening to nothing.
 */
export interface ServeResult {
  serverUrl: string;
  /** Where a browser should be sent, or null when this install ships no UI —
   *  a checkout that has not been built. `--open` says so rather than opening
   *  a window on nothing. */
  uiUrl: string | null;
}

const teardownSteps: ShutdownStep[] = [];
function registerTeardown(name: TeardownStepName, run: () => Promise<void>): void {
  teardownSteps.unshift({ name, timeoutMs: TEARDOWN_BUDGETS_MS[name], run });
}

async function boot(version: string): Promise<ServeResult> {
  const checkoutPath = resolveCheckoutRoot();
  const config = resolveAppConfig({ checkoutPath, env: process.env });
  mkdirSync(config.dataDir, { recursive: true });
  if (config.mode === "dev" && config.dataDirSource === "default") {
    ensureDevDataDirOwnership(config.dataDir, checkoutPath);
  }

  const db = createConnection(config.databasePath);
  registerTeardown("db", async () => {
    closeConnection(db);
  });
  const schemaVersion = getSchemaVersion(db, runMigrations(db, resolveMigrationsFolder()));

  // Minted before anything is served and published only once the port is
  // BOUND (below), so a reader never learns an address before it answers.
  const serverToken = mintServerToken();
  const bus = new WsBus({ version });
  // The knowledge runtime needs the vault service the runtime hands back, so
  // the hook late-binds; changes before it exists are covered by the boot
  // reconcile the first pass always runs.
  let knowledgeRef: KnowledgeRuntime | null = null;
  let noteIntelligenceRef: NoteIntelligence | null = null;
  const vaultArgs: VaultRuntimeArgs = {
    vaultDir: config.vaultDir,
    vaultRemote: config.vaultRemote,
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
  const vault = await createVaultRuntime(vaultArgs);
  registerTeardown("vault", () => vault.dispose());
  const knowledge = createKnowledgeRuntime({
    dataDir: config.dataDir,
    vault: vault.service,
    vaultRoot: config.vaultDir,
  });
  registerTeardown("knowledge", () => knowledge.dispose());
  knowledgeRef = knowledge;
  const uiDir = resolveUiDir();
  const ui: AppUi = uiDir === null ? { kind: "none" } : { kind: "bundle", clientDir: uiDir };

  // Rebuilt after listen, when the CLI bin dir and the skills dir have been
  // resolved; read lazily by the agent runtime on the first turn, which an
  // HTTP request precedes. The data dir is known here, so a turn that somehow
  // raced the rebuild still names the right instance.
  let agentShellEnv: AgentShellEnv = { INTELIGIR_DATA_DIR: config.dataDir };
  const cliBinDir = resolveCliBinDir();
  // The connectors registry (issue #591): ONE service, consumed twice — the
  // routes edit it, session launch composes its enabled rows into every
  // harness's mcpServers.
  const connectorsStore = createConnectorsStore(config.dataDir);
  const connectors = createConnectorsService(connectorsStore);
  // The OAuth dance for hosted rows (issue #602): the pairing discipline over
  // the same store — one pending slot, tokens landing beside the row.
  const connectorsOauth = createConnectorOauthFlow(connectorsStore);
  // Connected Folders (issue #601): reference dirs sessions are told about —
  // an affordance and an instructions line, never a permission grant.
  const folders = createFoldersService({
    store: createFoldersStore(config.dataDir),
    vaultDir: config.vaultDir,
    dataDir: config.dataDir,
  });
  // Note Intelligence (issue #590): OFF until the Settings toggle turns it
  // on; the files-changed hook below only ever schedules, never spawns, while
  // disabled.
  const noteIntelligence = createNoteIntelligence({
    infer: createCliInferenceRunner({ cwd: config.dataDir }),
    settings: createNoteIntelligenceSettingsStore(config.dataDir),
    vault: vault.service,
    onLog: (message) => {
      console.error(message);
    },
  });
  registerTeardown("intelligence", async () => {
    noteIntelligence.dispose();
  });
  noteIntelligenceRef = noteIntelligence;

  const agentDriver = resolveAgentDriver({
    config,
    db,
    notifier: bus,
    vault,
    cliBinDir,
    mcpServers: () => composeSessionMcpServers(connectors, connectorsOauth),
    captureProposals: createTurnProposalCapture({
      db,
      notifier: bus,
      git: vault.git,
      vault: vault.service,
      onDebug: (message) => {
        console.error(`proposals: ${message}`);
      },
    }),
    shellEnv: () => ({ ...withConnectedDirs(agentShellEnv, folders.list()) }),
    connectedDirs: () => folders.list(),
  });
  registerTeardown("agent", () => {
    // The oauth flow serves agent sessions; it stops when they do — a
    // callback landing after this exchanges nothing and writes nothing.
    connectorsOauth.dispose();
    return agentDriver.dispose();
  });

  const { app, cloud, injectWebSocket, voice, voiceStreamHub } = createApp({
    connectors,
    connectorsOauth,
    folders,
    noteIntelligence,
    agent: agentDriver.status,
    bus,
    // The real dial, injected because it cannot be imported from `app.ts` —
    // see `cloud/cloud-socket.ts`. This is the ONE place that supplies it.
    cloudTransport: { openSocket: openCloudSocket },
    config,
    createTurnDriver: agentDriver.createTurnDriver,
    db,
    ui,
    serverToken,
    knowledge,
    schemaVersion,
    startedAt: Date.now(),
    vault,
    version,
  });
  registerTeardown("cloud", () => cloud.dispose());
  registerTeardown("voice", () => voice.dispose());

  const { port, server } = await listenWithRetry({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: config.port,
    probeOnBusyPort: config.mode === "dev" && config.portSource === "default",
  });
  // Both kinds of upgraded socket are closed by name in the listener step: the
  // invalidation bus AND every live dictation stream. Each detaches from the
  // HTTP server's connection tracking on upgrade, so an open one of EITHER would
  // stall `server.close()` past the vault flush behind it.
  const upgradedSockets: UpgradedSockets = {
    closeAllClients: () => {
      bus.closeAllClients();
      voiceStreamHub.closeAllClients();
    },
    terminateAllClients: () => {
      bus.terminateAllClients();
      voiceStreamHub.terminateAllClients();
    },
  };
  // The file names this listener, so it dies with it — inside the step rather
  // than as one of its own, because a row pointing at a port that is closing
  // is worse than no row at all.
  registerTeardown("listener", async () => {
    removeServerFile(config.dataDir);
    await closeServer(server, upgradedSockets);
  });
  // The BOUND port, never the configured one: a derived dev port may have been
  // probed upward, and a caller that dialled the configured value would find
  // whichever neighbour won the race.
  writeServerFile(config.dataDir, {
    port,
    token: serverToken,
    vaultDir: config.vaultDir,
    pid: process.pid,
  });
  injectWebSocket(server);
  // Nothing ever scheduled the boot pass, so the hydrate-and-reconcile landed
  // in front of whichever query settled first — the user's first ⌘K. Kicked
  // here rather than before `listen`, because it is not what the port waits on:
  // an unsettled index only delays the searches that ask for it.
  void knowledge.settle().catch(() => {
    // Logged inside the pass; a rebuild that fails again fails the query that
    // needs it, and boot is not that query.
  });
  agentShellEnv = buildAgentShellEnv({
    dataDir: config.dataDir,
    env: process.env,
    cliBinDir,
  });
  console.log(
    `inteligir ${version} (${config.mode}) listening on http://127.0.0.1:${port} — data: ${config.dataDir} — vault: ${config.vaultDir}${config.vaultRemote === null ? "" : ` ⇄ ${redactRemoteUrl(config.vaultRemote)}`}`,
  );
  console.log(
    `agent: ${agentDriver.status.runtime}${agentDriver.status.detail === null ? "" : ` — ${agentDriver.status.detail}`}`,
  );
  const serverUrl = `http://127.0.0.1:${port}`;
  return { serverUrl, uiUrl: ui.kind === "bundle" ? `${serverUrl}/` : null };
}

/**
 * Boot the server and stay up until a signal takes it down.
 *
 * Every handler is installed around the boot rather than at module scope: this
 * module is one branch of a CLI, so nothing may run merely because it was
 * imported. The ORDER inside is still load-bearing — the shutdown signals go on
 * BEFORE the boot, so a ^C during a slow first boot (a cold vault reconcile, a
 * clone) tears down what exists instead of being ignored.
 */
export async function runServe(version: string): Promise<ServeResult> {
  const shutdown = createGracefulShutdown({
    steps: teardownSteps,
    onStepFailed: (name, error) => {
      console.error(`shutdown: ${name} failed`, error);
    },
    onTimeout: (deadlineMs) => {
      console.error(`shutdown: still running after ${deadlineMs}ms — exiting anyway`);
    },
  });

  installShutdownSignals({
    shutdown,
    target: process,
    onImpatient: (signal) => {
      console.error(`shutdown: ${signal} again — leaving now`);
      process.exit(1);
    },
    onUncleanExit: (failed) => {
      console.error(`shutdown: incomplete — ${failed.join(", ")} did not finish; exiting non-zero`);
    },
  });

  const booted = await boot(version).catch(async (cause: unknown) => {
    console.error(
      `inteligir failed to start: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`,
    );
    // Whatever came up must come down, or the process lives on inside the
    // watcher fork's IPC channel with nothing listening.
    await shutdown.run();
    // EXIT, do not merely set a code: the boot forks a filesystem watcher
    // before it binds a port, and that child's IPC channel is a live handle. A
    // failure after the fork (an occupied port is the ordinary one) leaves an
    // event loop that never drains, so the command would print its error and
    // then hang forever with nothing listening.
    process.exit(1);
  });

  installFatalErrorHandlers({
    shutdown,
    target: process,
    onFatal: (event, reason) => {
      console.error(`fatal: ${event} —`, reason);
    },
  });

  return booted;
}
