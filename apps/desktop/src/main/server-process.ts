// The server as a CHILD, and the reason is not crash tolerance — it is that
// the two runtimes disagree. The server opens better-sqlite3 synchronously,
// forks a @parcel/watcher child and shells out to git; running it inside the
// Electron main process would put all of that on the event loop that paints
// the window, and would bind the vault's lifetime to the compositor's.
//
// `utilityProcess` rather than a hand-rolled supervisor: it IS a managed Node
// child with an owned lifecycle, so the signal plumbing and the process
// bookkeeping a supervisor existed to provide are the runtime's. Two things it
// does NOT do, and this module owns both: it does not know WHEN the server is
// ready (that is when the child publishes `<dataDir>/server.json` and answers
// its own token), and it does not RESTART a child that dies.
//
// THE CRASH POLICY IS DELIBERATE AND IT IS NOT A RESTART LADDER. A restart
// mints a fresh token, and the window's protocol handler and socket-credential
// filter are bound to the current one — rewiring them would mean re-registering
// the app scheme, which throws on a session that already handles it. So an
// unexpected exit surfaces a dialog and quits; a clean relaunch re-establishes
// every one of those bindings from scratch. Simpler, and it cannot leave a
// window talking to a server with a stale bearer.
//
// SIGTERM STILL MATTERS, and it is why `kill()` is not the whole story: the
// server's ordered teardown listens for it, and the step it protects is the
// vault's final commit. `utilityProcess.kill()` sends SIGTERM on POSIX, so the
// grace below is a real wait for that teardown rather than a courtesy — DERIVED
// from the server's own budget, because a grace shorter than the flush lands
// the kill mid-commit. Past the grace a wedged child is SIGKILLed, so quitting
// the app can never hang on it.

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
  /** The child died on its own, outside a `stop()` — the server is gone and
   *  the window is now talking to nothing. Not called for an exit `stop()`
   *  asked for, nor before the child was ever ready (that rejects `start()`). */
  onUnexpectedExit: (code: number | null) => void;
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
  /** Set once the child was ready, so an exit BEFORE readiness rejects `start()`
   *  rather than firing the crash handler on a boot that never came up. */
  let becameReady = false;
  /** Set the moment `stop()` asks the child to leave, so its own exit does not
   *  read as a crash. */
  let stopping = false;

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
      running.kill();
      const step = Math.max(50, Math.floor(STOP_GRACE_MS / 20));
      for (let waited = 0; waited < STOP_GRACE_MS; waited += step) {
        if (exited) {
          return;
        }
        await delay(step);
      }
      // The graceful teardown overran its own budget — SIGKILL so `before-quit`
      // cannot hang the app on a wedged child.
      args.log(`the server did not exit within ${STOP_GRACE_MS}ms of SIGTERM — sending SIGKILL`);
      if (running.pid !== undefined) {
        try {
          process.kill(running.pid, "SIGKILL");
        } catch {
          // Already gone between the last poll and here.
        }
      }
    },
  };
}
