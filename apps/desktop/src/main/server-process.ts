// The server as a CHILD, and the reason is not crash tolerance — it is that
// the two runtimes disagree. The server opens better-sqlite3 synchronously,
// forks a @parcel/watcher child and shells out to git; running it inside the
// Electron main process would put all of that on the event loop that paints
// the window, and would bind the vault's lifetime to the compositor's.
//
// `utilityProcess` rather than a hand-rolled supervisor: it IS a managed Node
// child with an owned lifecycle, so the health poll, the restart ladder and the
// signal plumbing a supervisor existed to provide are the runtime's. What is
// left is the one thing the runtime does not know — WHEN the server is ready,
// which is when it publishes `<dataDir>/server.json` and answers its own token.
//
// SIGTERM STILL MATTERS, and it is why `kill()` is not the whole story: the
// server's ordered teardown listens for it, and the step it protects is the
// vault's final commit. `utilityProcess.kill()` sends SIGTERM on POSIX, so the
// grace below is a real wait for that teardown rather than a courtesy — DERIVED
// from the server's own budget, because a grace shorter than the flush lands
// the kill mid-commit.

import { utilityProcess, type UtilityProcess } from "electron";
import { SHUTDOWN_TIMEOUT_MS } from "inteligir/server/shutdown";

/** Headroom on top of the server's OWN teardown budget, for the signal to
 *  arrive and the process to actually leave after its last step. */
const STOP_GRACE_HEADROOM_MS = 5_000;

const STOP_GRACE_MS = SHUTDOWN_TIMEOUT_MS + STOP_GRACE_HEADROOM_MS;

/** How long a fresh child gets to publish itself before it counts as failed. */
const READY_TIMEOUT_MS = 45_000;
/** A warm boot answers in under 200ms, so the poll starts far below that and
 *  backs off — a fixed quarter-second grid is coarser than the whole boot, and
 *  the window would wait for the grid rather than for the server. */
const READY_POLL_MIN_MS = 25;
const READY_POLL_MAX_MS = 250;

export interface ServerProcessArgs {
  /** The CLI bundle to fork. `serve` is its only argument — every other verb
   *  is a client. */
  entryPath: string;
  /** The instance the child is told to serve, so it resolves nothing itself
   *  and cannot land somewhere this shell did not mean. */
  env: Readonly<Record<string, string>>;
  /** True once the child has published itself AND answered its own token. */
  isReady: () => Promise<boolean>;
  log: (message: string) => void;
}

export interface ServerProcess {
  /** Resolves once the child is ready; rejects when it never becomes so. */
  start(): Promise<void>;
  /** SIGTERM, then a DERIVED grace, then the hard kill. */
  stop(): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createServerProcess(args: ServerProcessArgs): ServerProcess {
  let child: UtilityProcess | null = null;
  let exited = false;

  return {
    async start() {
      const spawned = utilityProcess.fork(args.entryPath, ["serve"], {
        // Piped so the server's own log lines reach the shell's, rather than
        // whichever terminal happened to launch the app.
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
      });

      const deadline = Date.now() + READY_TIMEOUT_MS;
      let interval = READY_POLL_MIN_MS;
      while (Date.now() < deadline) {
        if (exited) {
          throw new Error("the server exited before it was ready");
        }
        if (await args.isReady()) {
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
      running.kill();
      const step = Math.max(50, Math.floor(STOP_GRACE_MS / 20));
      for (let waited = 0; waited < STOP_GRACE_MS; waited += step) {
        if (exited) {
          return;
        }
        await delay(step);
      }
      args.log(`the server did not exit within ${STOP_GRACE_MS}ms of SIGTERM`);
    },
  };
}
