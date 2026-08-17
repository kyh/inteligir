// The shell supervises the server as a CHILD PROCESS, and the reason is not
// crash tolerance — it is that the two runtimes disagree. The server opens
// better-sqlite3 and forks a @parcel/watcher child; running it inside the
// Electron main process would put a git subprocess, a filesystem watcher and
// every SQLite write on the same event loop that paints the window, and would
// bind the vault's lifetime to the compositor's. A child also makes the
// failure modes ordinary: a crash restarts, a quit kills, and neither takes
// the other down. (`npx inteligir` is the opposite case and runs the server
// in-process — one process, one exit code.)
//
// Nothing here imports `electron`, so every path below is drivable from a test
// with a fake child.

export interface SupervisedChild {
  readonly pid: number | undefined;
  kill(signal: NodeJS.Signals): boolean;
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
}

/** Cancels a scheduled repeat. */
type CancelSchedule = () => void;

export interface SupervisorDeps {
  spawnServer(): SupervisedChild;
  /** True when the server answered its health route. */
  probeHealth(): Promise<boolean>;
  delay(ms: number): Promise<void>;
  /** Repeating timer seam — a fake one is what makes the liveness poll
   *  testable without a real clock. */
  schedule(intervalMs: number, tick: () => void): CancelSchedule;
  log(message: string): void;
}

export interface SupervisorLimits {
  /** How long a fresh child gets to answer health before it counts as failed. */
  bootTimeoutMs: number;
  /** Gap between health probes while waiting for boot. */
  bootProbeIntervalMs: number;
  /** Cadence of the liveness poll once the server is up. */
  livenessIntervalMs: number;
  /** Consecutive liveness failures that mean "wedged" — one missed probe is a
   *  busy moment, not a dead server. */
  livenessFailuresBeforeRestart: number;
  /** Delays between successive restarts; the last one repeats. */
  restartDelaysMs: readonly number[];
  /** Consecutive failed restarts before the supervisor gives up. */
  maxConsecutiveRestarts: number;
  /** Grace between SIGTERM and SIGKILL on stop. */
  stopGraceMs: number;
}

export const DEFAULT_SUPERVISOR_LIMITS: SupervisorLimits = {
  bootTimeoutMs: 45_000,
  bootProbeIntervalMs: 250,
  livenessIntervalMs: 15_000,
  livenessFailuresBeforeRestart: 3,
  restartDelaysMs: [500, 1_000, 2_000, 5_000],
  maxConsecutiveRestarts: 5,
  stopGraceMs: 8_000,
};

export type SupervisorState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "up" }
  | { kind: "restarting"; attempt: number }
  | { kind: "failed"; reason: string }
  | { kind: "stopped" };

export interface Supervisor {
  readonly state: SupervisorState;
  /** Boot a child and resolve once it answers health. Rejects when it never
   *  does — the caller shows that, rather than a blank window. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Fired on every transition, so the window can reload when the server comes
   *  back and say something when it does not. */
  onStateChanged(listener: (state: SupervisorState) => void): void;
}

/** The delay before restart `attempt` (1-based); the last entry repeats. */
export function restartDelayMs(delays: readonly number[], attempt: number): number {
  if (delays.length === 0) {
    return 0;
  }
  const index = Math.min(attempt, delays.length) - 1;
  return delays[Math.max(index, 0)] ?? 0;
}

export function createSupervisor(deps: SupervisorDeps, limits: SupervisorLimits): Supervisor {
  let state: SupervisorState = { kind: "idle" };
  let child: SupervisedChild | null = null;
  let stopping = false;
  let cancelLiveness: CancelSchedule | null = null;
  let livenessFailures = 0;
  let consecutiveRestarts = 0;
  const listeners = new Set<(state: SupervisorState) => void>();

  function setState(next: SupervisorState): void {
    state = next;
    for (const listener of listeners) {
      listener(next);
    }
  }

  function stopLiveness(): void {
    cancelLiveness?.();
    cancelLiveness = null;
    livenessFailures = 0;
  }

  async function waitForHealth(): Promise<boolean> {
    const attempts = Math.max(1, Math.ceil(limits.bootTimeoutMs / limits.bootProbeIntervalMs));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (stopping) {
        return false;
      }
      if (await deps.probeHealth()) {
        return true;
      }
      await deps.delay(limits.bootProbeIntervalMs);
    }
    return false;
  }

  function startLiveness(): void {
    stopLiveness();
    cancelLiveness = deps.schedule(limits.livenessIntervalMs, () => {
      void (async () => {
        if (stopping || state.kind !== "up") {
          return;
        }
        if (await deps.probeHealth()) {
          livenessFailures = 0;
          return;
        }
        livenessFailures += 1;
        if (livenessFailures < limits.livenessFailuresBeforeRestart) {
          return;
        }
        deps.log(`server missed ${livenessFailures} health probes — restarting it`);
        stopLiveness();
        // A wedged process holds the port; kill it and let the exit handler
        // run the ordinary restart path rather than opening a second one.
        child?.kill("SIGKILL");
      })();
    });
  }

  function spawnAndWatch(): void {
    const spawned = deps.spawnServer();
    child = spawned;
    spawned.onExit((code, signal) => {
      if (child !== spawned) {
        return;
      }
      child = null;
      stopLiveness();
      if (stopping) {
        setState({ kind: "stopped" });
        return;
      }
      deps.log(`server exited (code ${code ?? "null"}, signal ${signal ?? "null"})`);
      void restart();
    });
  }

  async function bootOnce(): Promise<boolean> {
    spawnAndWatch();
    const healthy = await waitForHealth();
    if (!healthy) {
      return false;
    }
    consecutiveRestarts = 0;
    setState({ kind: "up" });
    startLiveness();
    return true;
  }

  async function restart(): Promise<void> {
    consecutiveRestarts += 1;
    if (consecutiveRestarts > limits.maxConsecutiveRestarts) {
      const reason = `the server failed to stay up after ${limits.maxConsecutiveRestarts} restarts`;
      deps.log(reason);
      setState({ kind: "failed", reason });
      return;
    }
    setState({ kind: "restarting", attempt: consecutiveRestarts });
    await deps.delay(restartDelayMs(limits.restartDelaysMs, consecutiveRestarts));
    if (stopping) {
      setState({ kind: "stopped" });
      return;
    }
    // A failed boot leaves no child, so nothing will fire the exit handler
    // that would otherwise drive the next attempt — recurse instead.
    if (!(await bootOnce())) {
      child?.kill("SIGKILL");
      child = null;
      await restart();
    }
  }

  return {
    get state() {
      return state;
    },
    onStateChanged(listener) {
      listeners.add(listener);
    },
    async start() {
      setState({ kind: "starting" });
      if (await bootOnce()) {
        return;
      }
      child?.kill("SIGKILL");
      child = null;
      const reason = `the server did not answer within ${limits.bootTimeoutMs}ms`;
      setState({ kind: "failed", reason });
      throw new Error(reason);
    },
    async stop() {
      stopping = true;
      stopLiveness();
      const running = child;
      if (running === null) {
        setState({ kind: "stopped" });
        return;
      }
      // SIGTERM is what the server's own graceful shutdown listens for: it
      // flushes the vault's pending commit and closes the database. SIGKILL is
      // the deadline behind it, never the first move.
      running.kill("SIGTERM");
      const deadline = limits.stopGraceMs;
      const step = Math.max(50, Math.floor(deadline / 20));
      for (let waited = 0; waited < deadline; waited += step) {
        if (child === null) {
          setState({ kind: "stopped" });
          return;
        }
        await deps.delay(step);
      }
      if (child !== null) {
        deps.log(`server did not exit within ${deadline}ms — killing it`);
        running.kill("SIGKILL");
      }
      setState({ kind: "stopped" });
    },
  };
}
