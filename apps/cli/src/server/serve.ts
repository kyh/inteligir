// in-process, not supervised: a supervisor buys restart-on-crash at the cost of
// a pid file, a health poll, signal forwarding and two sources of exit code,
// and none of that helps the failure this shape has — a boot that throws.

import { mkdirSync } from "node:fs";
import { inspect } from "node:util";
import { createCloudSocketOpener } from "@repo/contract/cloud/sync/cloud-socket";
import { browserHandoffUrl } from "@repo/contract/local/routes";
import { resolveUiDir } from "../paths";
import { resolveAgentDriver } from "./agents/agent-driver";
import { createApp } from "./app";
import { bootReport } from "./boot-report";
import { composeRuntime, registerListener, registerLockRelease } from "./compose";
import type { ComposeRuntimeArgs } from "./compose";
import { resolveAppConfig } from "./config";
import { ensureDevDataDirOwnership } from "./data-dir";
import { resolveCheckoutRoot } from "./dev-instance";
import { closeServer, guardUpgradeSockets, listenWithRetry } from "./listen";
import { LOOPBACK_HOST } from "./loopback-origin";
import { acquireServeLock, serveLockPath } from "./serve-lock";
import { loopbackOrigin, mintServerToken, removeServerFile, writeServerFile } from "./server-file";
import { probeServerFile, processAlive, silentOwnerSentence } from "./server-probe";
import type { ServerFileProbe } from "./server-probe";
import {
  createGracefulShutdown,
  ignoreDeadStreamErrors,
  installFatalErrorHandlers,
  installShutdownSignals,
} from "./shutdown";
import type { ShutdownStep } from "./shutdown";
import { uiDevOrigin } from "./ui-dev-server";

// passed as env rather than written to process.env: a global write is inherited by every child
// this server spawns.
export interface ServeOverrides {
  INTELIGIR_PORT?: string;
  INTELIGIR_DATA_DIR?: string;
}

export interface ServeResult {
  serverUrl: string;
  // a single-use sign-in for one browser; null when this install ships no UI (an unbuilt checkout).
  uiUrl: string | null;
}

// null when the row's owner no longer holds the data dir. silence counts as live; a refused
// connection is an answer, so an unrelated process that inherited the pid cannot block boot forever.
const liveOwnerRefusal = (dataDir: string, probe: ServerFileProbe): string | null => {
  switch (probe.kind) {
    case "silent": {
      return silentOwnerSentence(dataDir, probe.row);
    }
    case "answered": {
      return probe.identity.dataDir === dataDir
        ? `An inteligir server already serves ${dataDir} on port ${String(probe.row.port)} (pid ${String(probe.row.pid)}).`
        : null;
    }
    case "none":
    case "dead-owner":
    case "refused":
    case "unreadable": {
      return null;
    }
    default: {
      const exhaustive: never = probe;
      return exhaustive;
    }
  }
};

const STOP_IT_FIRST = "Stop it first, or select another instance with INTELIGIR_DATA_DIR.";

export const assertNoLiveServer = async (dataDir: string): Promise<void> => {
  const refusal = liveOwnerRefusal(dataDir, await probeServerFile(dataDir));
  if (refusal !== null) {
    throw new Error(`${refusal} ${STOP_IT_FIRST}`);
  }
};

// a holder that has published is judged by its row, as the guard judges it, so a lock a crash
// left behind cannot block boot once its pid belongs to something else.
const lockHolderLive = async (dataDir: string, pid: number): Promise<boolean> => {
  if (!processAlive(pid)) {
    return false;
  }
  const probe = await probeServerFile(dataDir);
  // no row of its own yet: a boot still composing.
  if (probe.kind === "none" || probe.row.pid !== pid) {
    return true;
  }
  return liveOwnerRefusal(dataDir, probe) !== null;
};

// before anything is composed, and released as the teardown's last step: the guard alone reads a
// row published only after listen, so two boots started together would both pass it.
export const claimDataDir = async (dataDir: string, teardown: ShutdownStep[]): Promise<void> => {
  await assertNoLiveServer(dataDir);
  mkdirSync(dataDir, { recursive: true });
  const claim = await acquireServeLock(dataDir, async (pid) => await lockHolderLive(dataDir, pid));
  if (claim.kind === "held") {
    const holder =
      claim.pid === null
        ? "Another inteligir server"
        : `An inteligir server (pid ${String(claim.pid)})`;
    throw new Error(
      `${holder} already holds ${dataDir}. ${STOP_IT_FIRST} If none is running, delete ${serveLockPath(dataDir)}.`,
    );
  }
  registerLockRelease(teardown, claim.release);
};

export interface RunServeOptions {
  // the desktop shell's lifeline (desktop/desktop-serve.ts): a stream it holds open and never
  // writes, so its end means the shell is gone
  lifeline?: NodeJS.ReadableStream;
}

const boot = async (
  version: string,
  env: NodeJS.ProcessEnv,
  teardown: ShutdownStep[],
): Promise<ServeResult> => {
  const began = performance.now();
  const checkoutPath = resolveCheckoutRoot();
  const config = resolveAppConfig({ checkoutPath, env });
  await claimDataDir(config.dataDir, teardown);
  const claimed = performance.now();
  if (config.mode === "dev" && config.dataDirSource === "default") {
    ensureDevDataDirOwnership(config.dataDir, checkoutPath);
  }

  // published only once the port is bound, so a reader never learns an address before it answers.
  const serverToken = mintServerToken();
  const clientDir = resolveUiDir();
  const uiDev = uiDevOrigin(env, config.mode);

  const composeArgs: ComposeRuntimeArgs = {
    // injected: the composed graph is also compiled under the browser tsconfig, where
    // WebSocket's second argument is a protocol list, not node's `{ headers }`.
    cloudTransport: {
      openSocket: createCloudSocketOpener((url, headers) => new WebSocket(url, { headers })),
    },
    config,
    driver: ({ config: driverConfig, bus, db }) =>
      resolveAgentDriver({ config: driverConfig, db, notifier: bus }),
    servesUi: clientDir !== null || uiDev !== null,
    teardown,
    version,
  };
  const runtime = await composeRuntime(composeArgs);
  const composed = performance.now();

  const { app, injectWebSocket, upgradedSockets } = createApp({
    bus: runtime.bus,
    clientDir,
    context: runtime.context,
    serverToken,
    uiDevOrigin: uiDev,
  });

  const { port, server } = await listenWithRetry({
    fetch: app.fetch,
    hostname: LOOPBACK_HOST,
    port: config.port,
    probeOnBusyPort: config.mode === "dev" && config.portSource === "default",
  });
  // removed inside the listener step: a row pointing at a closing port is worse than none.
  registerListener(teardown, async () => {
    removeServerFile(config.dataDir, serverToken);
    await closeServer(server, upgradedSockets);
  });
  // the bound port, never the configured one: a dev port may have been probed upward.
  writeServerFile(config.dataDir, {
    pid: process.pid,
    port,
    token: serverToken,
    version,
  });
  guardUpgradeSockets(server);
  injectWebSocket(server);
  const listening = performance.now();
  console.log(
    bootReport({
      claimMs: claimed - began,
      composeMs: composed - claimed,
      listenMs: listening - composed,
    }),
  );
  const agent = runtime.context.system.agent();
  const serverUrl = loopbackOrigin(port);
  console.log(
    `inteligir ${version} (${config.mode}) listening on ${serverUrl} — data: ${config.dataDir}`,
  );
  console.log(`agent: ${agent.runtime}${agent.detail === null ? "" : ` — ${agent.detail}`}`);
  const uiUrl =
    clientDir === null && uiDev === null
      ? null
      : browserHandoffUrl(`${serverUrl}/`, runtime.context.browserSession.mintHandoff());
  return { serverUrl, uiUrl };
};

// both installers go on before the boot, over the live steps array: a ^C during
// a slow first boot tears down what exists, and a fatal mid-boot leaves through
// the same teardown.
export const runServe = async (
  version: string,
  overrides: ServeOverrides = {},
  options: RunServeOptions = {},
): Promise<ServeResult> => {
  const teardown: ShutdownStep[] = [];
  const shutdown = createGracefulShutdown({
    onStepFailed: (name, error) => {
      console.error(`shutdown: ${name} failed`, error);
    },
    onTimeout: (deadlineMs) => {
      console.error(`shutdown: still running after ${deadlineMs}ms — exiting anyway`);
    },
    steps: teardown,
  });

  const env = { ...process.env, ...overrides };

  ignoreDeadStreamErrors([process.stdout, process.stderr]);
  installShutdownSignals({
    onImpatient: (signal) => {
      console.error(`shutdown: ${signal} again — leaving now`);
      process.exit(1);
    },
    onUncleanExit: (failed) => {
      console.error(`shutdown: incomplete — ${failed.join(", ")} did not finish; exiting non-zero`);
    },
    shutdown,
    target: process,
  });

  installFatalErrorHandlers({
    onFatal: (event, reason) => {
      console.error(`fatal: ${event} —`, reason);
    },
    shutdown,
    target: process,
  });

  // watched only once the signals above are, so a shell gone mid-boot reaches the teardown: a
  // server whose app crashed or was killed must not go on holding the data dir. a stop already
  // under way needs no second signal, which would read as impatience and skip the flush
  if (options.lifeline !== undefined) {
    options.lifeline.on("end", () => {
      if (!shutdown.started) {
        process.kill(process.pid, "SIGTERM");
      }
    });
    options.lifeline.resume();
  }

  try {
    return await boot(version, env, teardown);
  } catch (error) {
    // inspect, not the stack: drizzle names the failed query and carries the driver's own error
    // (`no such table: meta`) as the cause, which only the inspection prints.
    console.error(
      `inteligir failed to start: ${error instanceof Error ? inspect(error) : String(error)}`,
    );
    await shutdown.run();
    // exit, not an exit code: a handle the failed boot left open would keep the loop from draining.
    process.exit(1);
  }
};
