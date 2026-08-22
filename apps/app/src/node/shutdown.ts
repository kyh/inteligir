// Graceful shutdown: the ordered teardown a signal runs, and the deadlines
// that guarantee the process leaves either way.
//
// ORDER IS THE CONTRACT, and it is one rule: every writer stops before the
// durable flush, and the flush happens before the handles close. So the steps
// run listener → voice → cloud → agent → knowledge → vault → db. The vault's dispose
// is the flush — it commits whatever the debounce was still holding — which is
// why nothing that can write a vault file may run after it.
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
// WHICH IS WHY THE SEQUENCE DEADLINE IS DERIVED, never declared. A number
// written beside the steps rather than FROM them is a second budget that
// silently becomes the real one the moment it falls below their sum — and
// what it then cuts short is whatever the order put last, which is the vault
// flush. Deriving is what makes "only a backstop" true rather than intended.
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

/** The default per-step budget. A step with a different shape (a git commit
 *  over a large tree) states its own, in {@link TEARDOWN_BUDGETS_MS}. */
export const DEFAULT_STEP_TIMEOUT_MS = 5_000;

/**
 * EVERY step this process can register, with the budget it gets — the one
 * place a teardown budget is written. `registerTeardown` takes a name from
 * this table, so a step cannot arrive carrying a number of its own, and the
 * deadlines below are sums over it rather than opinions about it.
 *
 * The order is the teardown order stated in the header; the sums do not
 * depend on it, but a reader comparing the two should not have to reorder.
 */
export const TEARDOWN_BUDGETS_MS = {
  listener: DEFAULT_STEP_TIMEOUT_MS,
  /** Dictation writes only into the shared model directory, and only while a
   *  download is in flight — aborting one is a signal, not a flush, so it
   *  takes the default and stops early rather than being waited on. */
  voice: DEFAULT_STEP_TIMEOUT_MS,
  /** Cloud sync is a WRITER — it applies pulled events into the database and
   *  writes claimed captures into the vault — so it stops above both, and its
   *  step waits out the pass in flight rather than abandoning a push whose ack
   *  has not landed. */
  cloud: DEFAULT_STEP_TIMEOUT_MS,
  agent: DEFAULT_STEP_TIMEOUT_MS,
  /** Note Intelligence only clears its debounce timer; an inference child in
   *  flight is a one-shot `claude -p` that dies with the process. */
  intelligence: DEFAULT_STEP_TIMEOUT_MS,
  knowledge: DEFAULT_STEP_TIMEOUT_MS,
  /** The final commit is a git subprocess over the whole dirty tree, which a
   *  large vault can make slow — and this is the step the entire ordering
   *  exists to protect. */
  vault: 8_000,
  db: DEFAULT_STEP_TIMEOUT_MS,
} as const satisfies Record<string, number>;

export type TeardownStepName = keyof typeof TEARDOWN_BUDGETS_MS;

/** Slack for the machinery between steps (the loop, the failure reporting),
 *  so the backstop cannot land ON a step's own deadline. */
const DEADLINE_SLACK_MS = 1_000;

function deadlineFor(budgets: readonly number[]): number {
  return budgets.reduce((total, budget) => total + budget, 0) + DEADLINE_SLACK_MS;
}

/**
 * The longest a teardown of EVERY step can honestly take. Exported for the
 * supervisor outside this process, which derives its own SIGKILL grace from
 * it: a grace shorter than this lands the kill mid-flush.
 */
export const SHUTDOWN_TIMEOUT_MS = deadlineFor(Object.values(TEARDOWN_BUDGETS_MS));

export interface ShutdownStep {
  /** Named for the log line a failure prints. */
  name: string;
  /** This step's own budget; {@link DEFAULT_STEP_TIMEOUT_MS} when absent. */
  timeoutMs?: number;
  run(): Promise<void>;
}

function stepTimeoutMs(step: ShutdownStep): number {
  return step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
}

/** What the steps ACTUALLY registered can spend, plus slack — the deadline a
 *  sequence gets when its caller states none, and the only bound under which
 *  "a backstop" is a true description of it. */
export function shutdownDeadlineMs(steps: readonly ShutdownStep[]): number {
  return deadlineFor(steps.map(stepTimeoutMs));
}

/** What the teardown actually managed. `failed` names the steps that threw or
 *  ran out of time, in order, so a caller can both exit honestly and say why. */
export interface ShutdownResult {
  ok: boolean;
  failed: readonly string[];
}

export interface GracefulShutdownArgs {
  /** Read at RUN time, so a caller that fills the array as its boot proceeds
   *  gets a deadline over what it actually registered. */
  steps: readonly ShutdownStep[];
  onStepFailed(name: string, cause: unknown): void;
  /** Called once, from the backstop, when the sequence has not finished. Told
   *  the deadline it just passed, because that number is derived and nobody
   *  else holds it. */
  onTimeout(deadlineMs: number): void;
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
  const timeoutMs = stepTimeoutMs(step);
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
    const deadlineMs = shutdownDeadlineMs(args.steps);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const backstop = new Promise<ShutdownResult>((resolve) => {
      timer = setTimeout(() => {
        args.onTimeout(deadlineMs);
        resolve({ ok: false, failed: ["<deadline>"] });
      }, deadlineMs);
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
  on(event: FatalEvent, handler: (cause: unknown) => void): void;
  exit(code: number): void;
}

export interface InstallFatalErrorHandlersArgs {
  shutdown: GracefulShutdown;
  target: FatalTarget;
  /** Reported before the teardown runs, because the teardown can take seconds
   *  and the cause is what someone reading the log needs first. */
  onFatal(event: FatalEvent, cause: unknown): void;
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
    args.target.on(event, (cause) => {
      args.onFatal(event, cause);
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
