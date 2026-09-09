// every writer stops before the vault flush, and the flush before the handles
// close. every step runs even after one throws, each under its own budget: a
// single budget lets one wedged step starve the vault flush behind it, so the
// sequence deadline is derived from the steps, never declared.

export const DEFAULT_STEP_TIMEOUT_MS = 5000;

// the one place a budget is written; teardownStep takes a name from here, so no step carries its own number.
/* oxlint-disable sort-keys -- listed in teardown order, which the per-step comments explain */
export const TEARDOWN_BUDGETS_MS = {
  listener: DEFAULT_STEP_TIMEOUT_MS,
  voice: DEFAULT_STEP_TIMEOUT_MS,
  // cloud sync writes the db and the vault, so it stops above both.
  cloud: DEFAULT_STEP_TIMEOUT_MS,
  agent: DEFAULT_STEP_TIMEOUT_MS,
  knowledge: DEFAULT_STEP_TIMEOUT_MS,
  // a git commit over a large dirty tree; the step the ordering exists to protect.
  vault: 8000,
  db: DEFAULT_STEP_TIMEOUT_MS,
} as const satisfies Record<string, number>;
/* oxlint-enable sort-keys */

export type TeardownStepName = keyof typeof TEARDOWN_BUDGETS_MS;

export const teardownStep = (name: TeardownStepName, run: ShutdownStep["run"]): ShutdownStep => ({
  name,
  run,
  timeoutMs: TEARDOWN_BUDGETS_MS[name],
});

// so the backstop cannot land on a step's own deadline.
const DEADLINE_SLACK_MS = 1000;

const deadlineFor = (budgets: readonly number[]): number =>
  budgets.reduce((total, budget) => total + budget, 0) + DEADLINE_SLACK_MS;

// the supervisor derives its SIGKILL grace from this; a shorter grace lands the kill mid-flush.
export const SHUTDOWN_TIMEOUT_MS = deadlineFor(Object.values(TEARDOWN_BUDGETS_MS));

export interface ShutdownStep {
  name: string;
  timeoutMs?: number;
  // a step that closes a handle synchronously is a step; runStep awaits either.
  run: () => void | Promise<void>;
}

const stepTimeoutMs = (step: ShutdownStep): number => step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;

export const shutdownDeadlineMs = (steps: readonly ShutdownStep[]): number =>
  deadlineFor(steps.map(stepTimeoutMs));

export interface ShutdownResult {
  ok: boolean;
  failed: readonly string[];
}

export interface GracefulShutdownArgs {
  // read at run time, so steps registered during boot count.
  steps: readonly ShutdownStep[];
  onStepFailed: (name: string, cause: unknown) => void;
  onTimeout: (deadlineMs: number) => void;
}

export interface GracefulShutdown {
  // idempotent: a second signal joins the first run rather than tearing down over half-closed resources.
  run: () => Promise<ShutdownResult>;
  readonly started: boolean;
}

class StepTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`${name} did not finish within ${timeoutMs}ms`);
    this.name = "StepTimeoutError";
  }
}

const runStep = async (step: ShutdownStep): Promise<void> => {
  const timeoutMs = stepTimeoutMs(step);
  const expired = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    expired.reject(new StepTimeoutError(step.name, timeoutMs));
  }, timeoutMs);
  // unref, so a step's timer never keeps the process alive after the teardown moved on.
  timer.unref?.();
  try {
    await Promise.race([step.run(), expired.promise]);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
};

export const createGracefulShutdown = (args: GracefulShutdownArgs): GracefulShutdown => {
  let inflight: Promise<ShutdownResult> | null = null;

  const runSteps = async (): Promise<ShutdownResult> => {
    const failed: string[] = [];
    for (const step of args.steps) {
      try {
        await runStep(step);
      } catch (error) {
        failed.push(step.name);
        args.onStepFailed(step.name, error);
      }
    }
    return { failed, ok: failed.length === 0 };
  };

  const runOnce = async (): Promise<ShutdownResult> => {
    const deadlineMs = shutdownDeadlineMs(args.steps);
    const backstop = Promise.withResolvers<ShutdownResult>();
    const timer = setTimeout(() => {
      args.onTimeout(deadlineMs);
      backstop.resolve({ failed: ["<deadline>"], ok: false });
    }, deadlineMs);
    timer.unref?.();
    try {
      return await Promise.race([runSteps(), backstop.promise]);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async run() {
      inflight ??= runOnce();
      return await inflight;
    },
    get started() {
      return inflight !== null;
    },
  };
};

export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

interface SignalTarget {
  on: (signal: NodeJS.Signals, handler: () => void) => void;
  exit: (code: number) => void;
}

export interface InstallShutdownSignalsArgs {
  shutdown: GracefulShutdown;
  target: SignalTarget;
  onImpatient: (signal: NodeJS.Signals) => void;
  onUncleanExit: (failed: readonly string[]) => void;
}

export const installShutdownSignals = (args: InstallShutdownSignalsArgs): void => {
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
};

export const FATAL_EVENTS = ["uncaughtException", "unhandledRejection"] as const;
export type FatalEvent = (typeof FATAL_EVENTS)[number];

interface FatalTarget {
  on: (event: FatalEvent, handler: (cause: unknown) => void) => void;
  exit: (code: number) => void;
}

export interface InstallFatalErrorHandlersArgs {
  shutdown: GracefulShutdown;
  target: FatalTarget;
  // reported before the teardown, which can take seconds.
  onFatal: (event: FatalEvent, cause: unknown) => void;
}

// node's default exits immediately, skipping the sqlite close that checkpoints
// the WAL and the vault's pending commit; exit 1 so a supervisor can tell a crash from a quit.
export const installFatalErrorHandlers = (args: InstallFatalErrorHandlersArgs): void => {
  for (const event of FATAL_EVENTS) {
    args.target.on(event, (cause) => {
      args.onFatal(event, cause);
      void (async () => {
        // run() is idempotent, so a second fatal during the teardown joins the first.
        await args.shutdown.run();
        args.target.exit(1);
      })();
    });
  }
};
