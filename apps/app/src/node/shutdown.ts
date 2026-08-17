// Graceful shutdown: the ordered teardown a signal runs, and the deadline that
// guarantees the process leaves either way.
//
// ORDER IS THE CONTRACT, and it is one rule: every writer stops before the
// durable flush, and the flush happens before the handles close. So the steps
// run listener → agent → knowledge → vault → db. The vault's dispose is the
// flush — it commits whatever the debounce was still holding — which is why
// nothing that can write a vault file may run after it.
//
// EVERY STEP RUNS, even after one throws. A teardown that abandons the
// remaining steps on the first failure loses the pending commit because a
// socket refused to close, which is the opposite of what a graceful shutdown
// is for; failures are reported and the sequence continues.
//
// THE DEADLINE IS NOT OPTIONAL. A step that never settles (a wedged git
// subprocess, a socket that will not drain) would leave a process that ignores
// ^C, so the whole sequence races a timer and the caller force-exits when it
// wins.
//
// A CRASH IS A SHUTDOWN TOO. An uncaught exception or an unhandled rejection
// exits by Node's default, skipping every step above — including the SQLite
// close that checkpoints the WAL sidecar and the vault flush that commits the
// last edits. `installFatalErrorHandlers` routes both through this same
// sequence and then leaves non-zero.

export interface ShutdownStep {
  /** Named for the log line a failure prints. */
  name: string;
  run(): Promise<void>;
}

export interface GracefulShutdownArgs {
  steps: readonly ShutdownStep[];
  /** How long the whole sequence gets before `onTimeout` fires. */
  timeoutMs: number;
  onStepFailed(name: string, error: unknown): void;
  /** Called once, from the deadline, when the sequence has not finished. */
  onTimeout(): void;
}

export interface GracefulShutdown {
  /**
   * Run the sequence. Idempotent: a second call (a second ^C, a SIGTERM after
   * a SIGINT) joins the first run rather than starting a concurrent teardown
   * over half-closed resources.
   */
  run(): Promise<void>;
  /** True once `run` has been called — the force-exit branch's condition. */
  readonly started: boolean;
}

export function createGracefulShutdown(args: GracefulShutdownArgs): GracefulShutdown {
  let inflight: Promise<void> | null = null;

  async function runSteps(): Promise<void> {
    for (const step of args.steps) {
      try {
        await step.run();
      } catch (error) {
        args.onStepFailed(step.name, error);
      }
    }
  }

  async function runOnce(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        args.onTimeout();
        resolve();
      }, args.timeoutMs);
    });
    try {
      await Promise.race([runSteps(), deadline]);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }

  return {
    run() {
      inflight ??= runOnce();
      return inflight;
    },
    get started() {
      return inflight !== null;
    },
  };
}

/** The signals a terminal (^C) and a supervisor (Electron, systemd, docker
 *  stop) use to ask for a clean exit. */
export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** The `process` surface the installers touch — injected so the wiring is
 *  drivable without signalling the test runner's own process. */
interface SignalTarget {
  on(signal: NodeJS.Signals, handler: () => void): void;
  exit(code: number): void;
}

export interface InstallShutdownSignalsArgs {
  shutdown: GracefulShutdown;
  target: SignalTarget;
  /** A SECOND signal while the first teardown is still running. The user (or
   *  the supervisor) has asked twice; honour it by leaving immediately rather
   *  than by starting a concurrent teardown over half-closed resources. */
  onImpatient(signal: NodeJS.Signals): void;
}

export function installShutdownSignals(args: InstallShutdownSignalsArgs): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    args.target.on(signal, () => {
      if (args.shutdown.started) {
        args.onImpatient(signal);
        return;
      }
      void (async () => {
        await args.shutdown.run();
        args.target.exit(0);
      })();
    });
  }
}

/** The two ways this process can die without anyone asking it to. */
export const FATAL_EVENTS = ["uncaughtException", "unhandledRejection"] as const;
export type FatalEvent = (typeof FATAL_EVENTS)[number];

interface FatalTarget {
  on(event: FatalEvent, handler: (reason: unknown) => void): void;
  exit(code: number): void;
}

export interface InstallFatalErrorHandlersArgs {
  shutdown: GracefulShutdown;
  target: FatalTarget;
  /** Reported before the teardown runs, because the teardown can take seconds
   *  and the cause is what someone reading the log needs first. */
  onFatal(event: FatalEvent, reason: unknown): void;
}

/**
 * A crash runs the SAME teardown a signal does, then leaves non-zero.
 *
 * Node's default for either event is to print and exit immediately, and this
 * process cannot afford that: SQLite runs in WAL, whose sidecar is
 * checkpointed only by the clean `closeConnection` that the shutdown sequence
 * performs, and the vault's pending auto-commit is flushed by the same
 * sequence. Dying without it leaves a `-wal` file to be recovered on the next
 * boot and the last few edits uncommitted — a data outcome, from a stray
 * rejection in some unrelated background task.
 *
 * The exit code is 1 and never 0: a supervisor (the Electron shell, a shell
 * script, systemd) has to be able to tell a crash from a quit.
 */
export function installFatalErrorHandlers(args: InstallFatalErrorHandlersArgs): void {
  for (const event of FATAL_EVENTS) {
    args.target.on(event, (reason) => {
      args.onFatal(event, reason);
      void (async () => {
        // `run()` is idempotent, so a second fatal during the teardown joins
        // the first sequence instead of tearing down over half-closed
        // resources — and the deadline inside it guarantees this returns.
        await args.shutdown.run();
        args.target.exit(1);
      })();
    });
  }
}
