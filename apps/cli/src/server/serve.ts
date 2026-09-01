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
import { resolveAgentDriver } from "./agents/agent-driver";
import { binaryOnPath } from "./agents/binary-on-path";
import { createConnectorsService } from "./connectors/connectors-service";
import { createConnectorOauthFlow } from "./connectors/oauth-flow";
import { composeSessionMcpServers } from "./connectors/session-servers";
import { createCliInferenceRunner, INFERENCE_BINARY } from "./note-intelligence/infer";
import {
  createNoteIntelligence,
  type NoteIntelligence,
} from "./note-intelligence/note-intelligence";
import { createNoteIntelligenceSettingsStore } from "./note-intelligence/settings-store";
import { createConnectorsStore } from "./connectors/connectors-store";
import { createFoldersService } from "./folders/folders-service";
import { createFoldersStore } from "./folders/folders-store";
import { resolveCliBinDir, resolveSkillsDir } from "./agents/agent-shell-env";
import { createApp } from "./app";
import { openCloudSocket } from "./cloud/cloud-socket";
import { resolveAppConfig, resolveCheckoutRoot } from "./config";
import { ensureDevDataDirOwnership } from "./data-dir";
import { errnoCode } from "./errno";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { closeServer, listenWithRetry, type UpgradedSockets } from "./listen";
import {
  mintServerToken,
  readServerFile,
  removeServerFile,
  writeServerFile,
  type ServerFile,
} from "./server-file";
import { createLocalClient } from "./local-client";
import {
  createGracefulShutdown,
  installFatalErrorHandlers,
  installShutdownSignals,
  TEARDOWN_BUDGETS_MS,
  type ShutdownStep,
  type TeardownStepName,
} from "./shutdown";
import { createVaultRemoteProvider } from "./cloud/vault-remote";
import { redactRemoteUrl } from "./vault/git";
import { createVaultRuntime, type VaultRuntimeArgs } from "./vault/vault-runtime";
import { WsBus } from "./ws-bus";

/**
 * What `serve`'s own flags override, as the ENVIRONMENT the config layer
 * already reads. A flag is passed in rather than written to `process.env`,
 * because a global write is inherited by every child this server spawns — an
 * agent shell, the watcher fork — where a `--vault` flag would then be
 * indistinguishable from the user's own setting.
 */
export interface ServeOverrides {
  INTELIGIR_PORT?: string;
  INTELIGIR_DATA_DIR?: string;
  INTELIGIR_VAULT_DIR?: string;
}

export interface ServeResult {
  serverUrl: string;
  /** Where a browser should be sent, or null when this install ships no UI —
   *  a checkout that has not been built. `--open` says so rather than opening
   *  a window on nothing. */
  uiUrl: string | null;
}

/**
 * The teardown, accumulated AS THE BOOT PROCEEDS.
 *
 * `unshift` rather than `push`, and the two orders coincide on purpose:
 * resources come up db → vault → knowledge → intelligence → agent → cloud →
 * voice → listener, so reversing creation yields exactly the teardown order
 * shutdown.ts states (listener → voice → cloud → agent → intelligence →
 * knowledge → vault → db).
 *
 * Registering each step the moment its resource exists is also what makes a
 * FAILED boot survivable: a listen that throws EADDRINUSE still has a vault
 * watcher forked and a database open, and without this the process would sit
 * there holding both, alive on the watcher's IPC channel and listening to
 * nothing.
 */
const teardownSteps: ShutdownStep[] = [];
function registerTeardown(name: TeardownStepName, run: () => Promise<void>): void {
  teardownSteps.unshift({ name, timeoutMs: TEARDOWN_BUDGETS_MS[name], run });
}

/** How long the row's owner gets to answer before it counts as wedged rather
 *  than gone. Its own deadline, not the client's, because the catch below has
 *  to tell "refused the connection" from "never answered". */
const OWNER_PROBE_TIMEOUT_MS = 1_500;

/** Is the process that wrote the row still there? EPERM is a live process this
 *  user may not signal, which is a different answer from ESRCH's "gone". */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) === "EPERM";
  }
}

/** What the row's owner said when asked which data dir it serves. */
type OwnerProbe =
  | { kind: "answered"; dataDir: string }
  | { kind: "silent" }
  | { kind: "unreachable" };

async function probeOwner(existing: ServerFile): Promise<OwnerProbe> {
  const client = createLocalClient({
    origin: `http://127.0.0.1:${String(existing.port)}`,
    token: existing.token,
    // Well past the deadline below, so the client's own abort can never be the
    // one that fires and turn a wedged owner into an "unreachable" answer.
    timeoutMs: OWNER_PROBE_TIMEOUT_MS * 4,
  });
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, OWNER_PROBE_TIMEOUT_MS);
  try {
    const status = await client.system.status(undefined, { signal: deadline.signal });
    return { kind: "answered", dataDir: status.dataDir };
  } catch {
    return deadline.signal.aborted ? { kind: "silent" } : { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refuse to start a SECOND server on an instance one already owns.
 *
 * `serve` has no adoption path (that is the desktop shell's job) — so without
 * this, a second `inteligir serve` for the same data dir binds a neighbouring
 * dev port, then overwrites the first's `server.json`, pointing every client at
 * the newcomer while the first still holds the vault, its watcher fork and the
 * git lock: two servers on one vault.
 *
 * THREE STATES, not two. A crashed owner leaves its row behind, and its PID is
 * what says so — cheaply, and without a round trip that a stale port could
 * answer. Only when that process still exists does the probe run, and then
 * SILENCE COUNTS AS LIVE: better-sqlite3 is synchronous, so a large knowledge
 * batch or a stalled fs call blocks the loop of a server that is very much
 * still holding the vault, and reading that as "nobody there" is the two-server
 * outcome this guard exists to prevent. A REFUSED connection is an answer, so
 * it proceeds — an unrelated process that inherited the pid must not make the
 * boot permanently unstartable.
 */
export async function assertNoLiveServer(dataDir: string): Promise<void> {
  const existing = readServerFile(dataDir);
  if (existing === null) return;
  if (!processAlive(existing.pid)) return;
  const probe = await probeOwner(existing);
  if (probe.kind === "unreachable") return;
  if (probe.kind === "answered" && probe.dataDir !== dataDir) return;
  const what =
    probe.kind === "silent"
      ? `An inteligir server (pid ${String(existing.pid)}) still holds ${dataDir} on port ${String(existing.port)} and is not answering.`
      : `An inteligir server already serves ${dataDir} on port ${String(existing.port)} (pid ${String(existing.pid)}).`;
  throw new Error(`${what} Stop it first, or select another instance with INTELIGIR_DATA_DIR.`);
}

async function boot(version: string, env: NodeJS.ProcessEnv): Promise<ServeResult> {
  const checkoutPath = resolveCheckoutRoot();
  const config = resolveAppConfig({ checkoutPath, env });
  await assertNoLiveServer(config.dataDir);
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
  const bus = new WsBus();
  // The knowledge runtime needs the vault service the runtime hands back, so
  // the hook late-binds; changes before it exists are covered by the boot
  // reconcile the first pass always runs.
  let knowledgeRef: KnowledgeRuntime | null = null;
  let noteIntelligenceRef: NoteIntelligence | null = null;
  const vaultRemote = createVaultRemoteProvider({
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
  const vault = await createVaultRuntime(vaultArgs);
  registerTeardown("vault", () => vault.dispose());
  const knowledge = createKnowledgeRuntime({
    dataDir: config.dataDir,
    vault: vault.service,
    vaultRoot: config.vaultDir,
  });
  registerTeardown("knowledge", () => knowledge.dispose());
  knowledgeRef = knowledge;
  const clientDir = resolveUiDir();

  // The layout's two facts about agent sessions, resolved once; the folders
  // below are the one that moves (agent-shell-env.ts).
  const cliBinDir = resolveCliBinDir();
  const skillsDir = resolveSkillsDir();
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
  // disabled. The PATH probe is the agent driver's, one spelling
  // (`binaryOnPath`) — an install without the vendor CLI says so in status
  // rather than spawning a command that is not there once per note.
  const noteIntelligence = createNoteIntelligence({
    availability:
      binaryOnPath(INFERENCE_BINARY, env) === null
        ? {
            kind: "unavailable",
            detail: `\`${INFERENCE_BINARY}\` was not found on PATH — note intelligence infers fields by running it.`,
          }
        : { kind: "available" },
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
    mcpServers: () => composeSessionMcpServers(connectors, connectorsOauth),
    sessionFacts: () => ({
      dataDir: config.dataDir,
      cliBinDir,
      skillsDir,
      connectedDirs: folders.list(),
    }),
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
    clientDir,
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
  const bootRemote = vaultRemote();
  console.log(
    `inteligir ${version} (${config.mode}) listening on http://127.0.0.1:${port} — data: ${config.dataDir} — vault: ${config.vaultDir}${bootRemote === null ? "" : ` ⇄ ${redactRemoteUrl(bootRemote.url)}${bootRemote.source === "paired" ? " (paired)" : ""}`}`,
  );
  console.log(
    `agent: ${agentDriver.status.runtime}${agentDriver.status.detail === null ? "" : ` — ${agentDriver.status.detail}`}`,
  );
  const serverUrl = `http://127.0.0.1:${port}`;
  return { serverUrl, uiUrl: clientDir === null ? null : `${serverUrl}/` };
}

/**
 * Boot the server and stay up until a signal takes it down.
 *
 * Every handler is installed around the boot rather than at module scope: this
 * module is one branch of a CLI, so nothing may run merely because it was
 * imported. The ORDER inside is still load-bearing — BOTH installers go on
 * BEFORE the boot. A ^C during a slow first boot (a cold vault reconcile, a
 * clone) tears down what exists instead of being ignored, and a fatal event
 * raised while the boot is still running reports itself and leaves through the
 * same teardown rather than by Node's default exit. `run()` is idempotent, so
 * a fatal during the boot and the boot's own `.catch` converge on one teardown
 * and one non-zero exit.
 */
export async function runServe(
  version: string,
  overrides: ServeOverrides = {},
): Promise<ServeResult> {
  const shutdown = createGracefulShutdown({
    steps: teardownSteps,
    onStepFailed: (name, error) => {
      console.error(`shutdown: ${name} failed`, error);
    },
    onTimeout: (deadlineMs) => {
      console.error(`shutdown: still running after ${deadlineMs}ms — exiting anyway`);
    },
  });

  const env = { ...process.env, ...overrides };

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

  installFatalErrorHandlers({
    shutdown,
    target: process,
    onFatal: (event, reason) => {
      console.error(`fatal: ${event} —`, reason);
    },
  });

  const booted = await boot(version, env).catch(async (cause: unknown) => {
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

  return booted;
}
