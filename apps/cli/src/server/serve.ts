// `inteligir serve` — the whole local server, in the process that ran the
// command. Boot order: config → composeRuntime (every service, compose.ts) →
// createApp (route wiring) → listen → server.json → injectWebSocket. What
// stays HERE is exactly what needs a process or a bound port: the single-owner
// guard, the listener and its teardown step, the published discovery file,
// signals, and the exit code.
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
import { resolveUiDir } from "../paths";
import { resolveAgentDriver } from "./agents/agent-driver";
import { resolveCliBinDir, resolveSkillsDir } from "./agents/agent-shell-env";
import { createApp } from "./app";
import { openCloudSocket } from "./cloud/cloud-socket";
import { composeRuntime, teardownStep } from "./compose";
import { composeSessionMcpServers } from "./connectors/session-servers";
import { resolveAppConfig } from "./config";
import { ensureDevDataDirOwnership } from "./data-dir";
import { resolveCheckoutRoot } from "./dev-instance";
import { errnoCode } from "./errno";
import { closeServer, listenWithRetry, type UpgradedSockets } from "./listen";
import { createLocalClient } from "./local-client";
import {
  mintServerToken,
  readServerFile,
  removeServerFile,
  writeServerFile,
  type ServerFile,
} from "./server-file";
import {
  createGracefulShutdown,
  installFatalErrorHandlers,
  installShutdownSignals,
  type ShutdownStep,
} from "./shutdown";
import { redactRemoteUrl } from "./vault/git";

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

async function boot(
  version: string,
  env: NodeJS.ProcessEnv,
  teardown: ShutdownStep[],
): Promise<ServeResult> {
  const checkoutPath = resolveCheckoutRoot();
  const config = resolveAppConfig({ checkoutPath, env });
  await assertNoLiveServer(config.dataDir);
  mkdirSync(config.dataDir, { recursive: true });
  if (config.mode === "dev" && config.dataDirSource === "default") {
    ensureDevDataDirOwnership(config.dataDir, checkoutPath);
  }

  // Minted before anything is served and published only once the port is
  // BOUND (below), so a reader never learns an address before it answers.
  const serverToken = mintServerToken();

  const runtime = await composeRuntime({
    config,
    env,
    version,
    teardown,
    // The real dial, injected because it cannot be imported from the composed
    // graph — see `cloud/cloud-socket.ts`. This is the ONE place that supplies
    // it, and the same goes for the agent resolver below.
    cloudTransport: { openSocket: openCloudSocket },
    driver: ({ config: driverConfig, db, bus, vault, connectors, connectorsOauth, folders }) => {
      // The layout's two facts about agent sessions, resolved once; the
      // folders below are the one that moves (agent-shell-env.ts).
      const cliBinDir = resolveCliBinDir();
      const skillsDir = resolveSkillsDir();
      return resolveAgentDriver({
        config: driverConfig,
        db,
        notifier: bus,
        vault,
        // The connectors registry consumed the second time: session launch
        // composes its enabled rows into every harness's mcpServers.
        mcpServers: () => composeSessionMcpServers(connectors, connectorsOauth),
        sessionFacts: () => ({
          dataDir: driverConfig.dataDir,
          cliBinDir,
          skillsDir,
          connectedDirs: folders.list(),
        }),
      });
    },
  });

  const clientDir = resolveUiDir();
  const { app, injectWebSocket } = createApp({
    context: runtime.context,
    bus: runtime.bus,
    voiceStreamHub: runtime.voiceStreamHub,
    serverToken,
    clientDir,
    configuredPort: config.port,
  });

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
      runtime.bus.closeAllClients();
      runtime.voiceStreamHub.closeAllClients();
    },
    terminateAllClients: () => {
      runtime.bus.terminateAllClients();
      runtime.voiceStreamHub.terminateAllClients();
    },
  };
  // The file names this listener, so it dies with it — inside the step rather
  // than as one of its own, because a row pointing at a port that is closing
  // is worse than no row at all. Unshifted onto the composed teardown, so the
  // listener closes before any service behind it.
  teardown.unshift(
    teardownStep("listener", async () => {
      removeServerFile(config.dataDir);
      await closeServer(server, upgradedSockets);
    }),
  );
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
  void runtime.context.knowledge.settle().catch(() => {
    // Logged inside the pass; a rebuild that fails again fails the query that
    // needs it, and boot is not that query.
  });
  const bootRemote = runtime.vaultRemote();
  const agent = runtime.context.system.agent;
  console.log(
    `inteligir ${version} (${config.mode}) listening on http://127.0.0.1:${port} — data: ${config.dataDir} — vault: ${config.vaultDir}${bootRemote === null ? "" : ` ⇄ ${redactRemoteUrl(bootRemote.url)}${bootRemote.source === "paired" ? " (paired)" : ""}`}`,
  );
  console.log(`agent: ${agent.runtime}${agent.detail === null ? "" : ` — ${agent.detail}`}`);
  const serverUrl = `http://127.0.0.1:${port}`;
  return { serverUrl, uiUrl: clientDir === null ? null : `${serverUrl}/` };
}

/**
 * Boot the server and stay up until a signal takes it down.
 *
 * Every handler is installed around the boot rather than at module scope: this
 * module is one branch of a CLI, so nothing may run merely because it was
 * imported. The ORDER inside is still load-bearing — BOTH installers go on
 * BEFORE the boot, over the LIVE steps array the composition fills as its
 * resources come up. A ^C during a slow first boot (a cold vault reconcile, a
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
  const teardown: ShutdownStep[] = [];
  const shutdown = createGracefulShutdown({
    steps: teardown,
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

  const booted = await boot(version, env, teardown).catch(async (cause: unknown) => {
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
