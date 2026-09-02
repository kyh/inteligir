// a child, not in-process: better-sqlite3, the watcher fork and git would share the
// compositor's event loop. no restart: a restarted child mints a fresh token, and
// rebinding the protocol handler to it means re-registering the scheme, which throws.

import { utilityProcess, type UtilityProcess } from "electron";
import { SHUTDOWN_TIMEOUT_MS } from "inteligir/server/shutdown";

const STOP_GRACE_HEADROOM_MS = 5_000;

const STOP_GRACE_MS = SHUTDOWN_TIMEOUT_MS + STOP_GRACE_HEADROOM_MS;

const READY_TIMEOUT_MS = 45_000;
// a warm boot answers in under 200ms; a fixed 250ms grid would be coarser than the whole boot.
const READY_POLL_MIN_MS = 25;
const READY_POLL_MAX_MS = 250;

export interface ServerProcessArgs {
  entryPath: string;
  env: Readonly<Record<string, string>>;
  isReady: () => Promise<boolean>;
  log: (message: string) => void;
  // not called for an exit `stop()` asked for, nor before readiness (that rejects `start()`).
  onUnexpectedExit: (code: number | null) => void;
}

export interface ServerProcess {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createServerProcess(args: ServerProcessArgs): ServerProcess {
  let child: UtilityProcess | null = null;
  let exited = false;
  let becameReady = false;
  let stopping = false;

  return {
    async start() {
      const spawned = utilityProcess.fork(args.entryPath, ["serve"], {
        stdio: "pipe",
        serviceName: "inteligir-server",
        env: { ...process.env, ...args.env },
      });
      child = spawned;
      spawned.stdout?.on("data", (chunk: Buffer) => args.log(chunk.toString().trimEnd()));
      spawned.stderr?.on("data", (chunk: Buffer) => args.log(chunk.toString().trimEnd()));
      spawned.on("exit", (code) => {
        exited = true;
        args.log(`server exited (code ${String(code)})`);
        if (becameReady && !stopping) {
          args.onUnexpectedExit(code);
        }
      });

      const deadline = Date.now() + READY_TIMEOUT_MS;
      let interval = READY_POLL_MIN_MS;
      while (Date.now() < deadline) {
        if (exited) {
          throw new Error("the server exited before it was ready");
        }
        if (await args.isReady()) {
          becameReady = true;
          return;
        }
        await delay(interval);
        interval = Math.min(interval * 2, READY_POLL_MAX_MS);
      }
      spawned.kill();
      throw new Error(`the server did not become ready within ${READY_TIMEOUT_MS}ms`);
    },

    async stop() {
      const running = child;
      if (running === null || exited) {
        return;
      }
      stopping = true;
      // SIGTERM on POSIX; the grace is the server's own teardown budget, so the vault's final commit is not killed mid-flush.
      running.kill();
      const step = Math.max(50, Math.floor(STOP_GRACE_MS / 20));
      for (let waited = 0; waited < STOP_GRACE_MS; waited += step) {
        if (exited) {
          return;
        }
        await delay(step);
      }
      args.log(`the server did not exit within ${STOP_GRACE_MS}ms of SIGTERM — sending SIGKILL`);
      if (running.pid !== undefined) {
        try {
          process.kill(running.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    },
  };
}
