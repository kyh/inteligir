// Graceful shutdown: the ordered teardown a signal runs, and the deadlines
// that guarantee the process leaves either way.
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
// EVERY STEP IS INDEPENDENTLY TIME-BOXED, and the whole-sequence deadline is
// only a backstop. A single budget for the whole teardown is not a bound on
// anything: a step that never settles (a wedged git subprocess, a socket that
// will not drain) consumes the entire budget and starves every step behind it,
// so the vault flush is skipped for exactly the reason the flush exists.
// Per-step means a wedged listener costs its own step and nothing else.
//
// THE EXIT CODE IS THE TRUTH. A failed final commit or a database that would
// not close is not a clean shutdown, and reporting 0 for one teaches every
// supervisor above to believe a lie.
//
// A CRASH IS A SHUTDOWN TOO. An uncaught exception or an unhandled rejection
// exits by Node's default, skipping every step above — including the SQLite
// close that checkpoints the WAL sidecar and the vault flush that commits the
// last edits. `installFatalErrorHandlers` routes both through this same
// sequence and then leaves non-zero.

/** How long the whole teardown gets. A backstop behind the per-step budgets,
 *  not the thing that bounds them — it only catches a step whose own timer
 *  somehow does not fire. */
export const SHUTDOWN_TIMEOUT_MS = 15_000;

/** The default per-step budget. A step with a different shape (a git commit
 *  over a large tree) states its own. */
export const DEFAULT_STEP_TIMEOUT_MS = 5_000;

export interface ShutdownStep {
  /** Named for the log line a failure prints. */
  name: string;
  /** This step's own budget; {@link DEFAULT_STEP_TIMEOUT_MS} when absent. */
  timeoutMs?: number;
  run(): Promise<void>;
}

/** What the teardown actually managed. `failed` names the steps that threw or
 *  ran out of time, in order, so a caller can both exit honestly and say why. */
export interface ShutdownResult {
  ok: boolean;
  failed: readonly string[];
}

export interface GracefulShutdownArgs {
  steps: readonly ShutdownStep[];
  /** Whole-sequence backstop; {@link SHUTDOWN_TIMEOUT_MS} when absent. */
  timeoutMs?: number;
  onStepFailed(name: string, error: unknown): void;
  /** Called once, from the backstop, when the sequence has not finished. */
  onTimeout(): void;
}

export interface GracefulShutdown {
  /**
   * Run the sequence. Idempotent: a second call (a second ^C, a SIGTERM after
   * a SIGINT) joins the first run rather than starting a concurrent teardown
   * over half-closed resources.
   */
  run(): Promise<ShutdownResult>;
  /** True once `run` has been called — the force-exit branch's condition. */
  readonly started: boolean;
}

class StepTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`${name} did not finish within ${timeoutMs}ms`);
  }
}

function runStep(step: ShutdownStep): Promise<void> {
  const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new StepTimeoutError(step.name, timeoutMs));
    }, timeoutMs);
    // `unref` so a step's own timer can never be the thing keeping the process
    // alive after the teardown has moved on.
    timer.unref?.();
    void (async () => {
      try {
        await step.run();
        clearTimeout(timer);
        resolve();
      } catch (error) {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

export function createGracefulShutdown(args: GracefulShutdownArgs): GracefulShutdown {
  let inflight: Promise<ShutdownResult> | null = null;

  async function runSteps(): Promise<ShutdownResult> {
    const failed: string[] = [];
    for (const step of args.steps) {
      try {
        await runStep(step);
      } catch (error) {
        failed.push(step.name);
        args.onStepFailed(step.name, error);
      }
    }
    return { ok: failed.length === 0, failed };
  }

  async function runOnce(): Promise<ShutdownResult> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const backstop = new Promise<ShutdownResult>((resolve) => {
      timer = setTimeout(() => {
        args.onTimeout();
        resolve({ ok: false, failed: ["<deadline>"] });
      }, args.timeoutMs ?? SHUTDOWN_TIMEOUT_MS);
      timer.unref?.();
    });
    try {
      return await Promise.race([runSteps(), backstop]);
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
  /** Told which steps failed, so the operator learns it from the log and the
   *  supervisor from the exit code. */
  onUncleanExit(failed: readonly string[]): void;
}

export function installShutdownSignals(args: InstallShutdownSignalsArgs): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    args.target.on(signal, () => {
      if (args.shutdown.started) {
        args.onImpatient(signal);
        return;
      }
      void (async () => {
        const result = await args.shutdown.run();
        if (!result.ok) {
          args.onUncleanExit(result.failed);
        }
        args.target.exit(result.ok ? 0 : 1);
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
