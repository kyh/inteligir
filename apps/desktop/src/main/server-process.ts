// a child, not in-process: better-sqlite3, the watcher fork and git would share the
// compositor's event loop. no restart: a restarted child mints a fresh token, and
// rebinding the protocol handler to it means re-registering the scheme, which throws.

import type { ForkOptions } from "electron";
import { SHUTDOWN_TIMEOUT_MS } from "inteligir/server/shutdown";

const STOP_GRACE_HEADROOM_MS = 5000;

export const STOP_GRACE_MS = SHUTDOWN_TIMEOUT_MS + STOP_GRACE_HEADROOM_MS;

export const READY_TIMEOUT_MS = 45_000;
// a warm boot answers in under 200ms; a fixed 250ms grid would be coarser than the whole boot.
const READY_POLL_MIN_MS = 25;
const READY_POLL_MAX_MS = 250;

// the slice of utilityProcess's child this module drives: index.ts forks the real one, a test a fake.
export interface ServerChild {
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  // SIGTERM on POSIX
  kill: () => boolean;
  once: (event: "exit", listener: (code: number) => void) => void;
}

type ForkServer = (modulePath: string, args: string[], options: ForkOptions) => ServerChild;

export interface ServerProcessArgs {
  entryPath: string;
  env: Readonly<Record<string, string>>;
  fork: ForkServer;
  isReady: () => Promise<boolean>;
  log: (message: string) => void;
  // not called for an exit `stop()` asked for, nor before readiness (that rejects `start()`).
  onUnexpectedExit: (code: number | null) => void;
}

export interface ServerProcess {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

interface RunningChild {
  child: ServerChild;
  exited: Promise<number>;
}

const GRACE_ELAPSED = "grace-elapsed";

// the global timer, not node:timers/promises: a test's fake clock reaches only the global one.
const sleep = async (ms: number): Promise<void> => {
  const elapsed = Promise.withResolvers<null>();
  setTimeout(() => {
    elapsed.resolve(null);
  }, ms);
  await elapsed.promise;
};

const exitsWithin = async (exited: Promise<number>, graceMs: number): Promise<boolean> => {
  const grace = Promise.withResolvers<typeof GRACE_ELAPSED>();
  const timer = setTimeout(() => {
    grace.resolve(GRACE_ELAPSED);
  }, graceMs);
  try {
    return (await Promise.race([exited, grace.promise])) !== GRACE_ELAPSED;
  } finally {
    clearTimeout(timer);
  }
};

type ReadinessOutcome = { kind: "exited"; code: number } | { kind: "probed"; ready: boolean };

const exitOutcome = async (exited: Promise<number>): Promise<ReadinessOutcome> => ({
  code: await exited,
  kind: "exited",
});

const probeOutcome = async (isReady: () => Promise<boolean>): Promise<ReadinessOutcome> => ({
  kind: "probed",
  ready: await isReady(),
});

export const createServerProcess = (args: ServerProcessArgs): ServerProcess => {
  // null before the fork and after the exit: either way there is nothing to stop.
  let running: RunningChild | null = null;
  let becameReady = false;
  let stopping = false;

  return {
    async start() {
      const child = args.fork(args.entryPath, ["serve"], {
        env: { ...process.env, ...args.env },
        serviceName: "inteligir-server",
        stdio: "pipe",
      });
      const exit = Promise.withResolvers<number>();
      running = { child, exited: exit.promise };
      child.stdout?.on("data", (chunk: Buffer) => {
        args.log(chunk.toString().trimEnd());
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        args.log(chunk.toString().trimEnd());
      });
      child.once("exit", (code) => {
        running = null;
        args.log(`server exited (code ${String(code)})`);
        if (becameReady && !stopping) {
          args.onUnexpectedExit(code);
        }
        exit.resolve(code);
      });

      // made once and raced first, so a child already gone wins over a probe that answers in the same turn.
      const exitedEarly = exitOutcome(exit.promise);
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let interval = READY_POLL_MIN_MS;
      while (Date.now() < deadline) {
        const outcome = await Promise.race([exitedEarly, probeOutcome(args.isReady)]);
        if (outcome.kind === "exited") {
          throw new Error(`the server exited before it was ready (code ${String(outcome.code)})`);
        }
        if (outcome.ready) {
          becameReady = true;
          return;
        }
        await sleep(interval);
        interval = Math.min(interval * 2, READY_POLL_MAX_MS);
      }
      child.kill();
      throw new Error(
        `the server was still booting when its ${READY_TIMEOUT_MS}ms readiness wait ran out, ` +
          "so it was stopped; it had neither failed nor exited",
      );
    },

    async stop() {
      const target = running;
      if (target === null) {
        return;
      }
      stopping = true;
      // the grace is the server's own teardown budget, so the vault's final commit is not killed mid-flush.
      target.child.kill();
      if (await exitsWithin(target.exited, STOP_GRACE_MS)) {
        return;
      }
      args.log(`the server did not exit within ${STOP_GRACE_MS}ms of SIGTERM — sending SIGKILL`);
      const { pid } = target.child;
      if (pid === undefined) {
        return;
      }
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone; its exit event is on its way
        return;
      }
      await target.exited;
    },
  };
};
