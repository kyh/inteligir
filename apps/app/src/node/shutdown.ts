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

/** The `process` surface the installer touches — injected so the wiring is
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
