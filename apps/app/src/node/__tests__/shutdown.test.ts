import { describe, expect, it, vi } from "vitest";
import {
  createGracefulShutdown,
  installShutdownSignals,
  SHUTDOWN_SIGNALS,
  type ShutdownStep,
} from "../shutdown";

function recordingStep(name: string, log: string[], run?: () => Promise<void>): ShutdownStep {
  return {
    name,
    async run() {
      log.push(name);
      await run?.();
    },
  };
}

const quiet = {
  onStepFailed: () => {},
  onTimeout: () => {},
};

describe("createGracefulShutdown", () => {
  it("runs the steps in declaration order", async () => {
    const log: string[] = [];
    const shutdown = createGracefulShutdown({
      ...quiet,
      timeoutMs: 1_000,
      steps: [
        recordingStep("listener", log),
        recordingStep("agent", log),
        recordingStep("knowledge", log),
        recordingStep("vault", log),
        recordingStep("db", log),
      ],
    });

    await shutdown.run();

    expect(log).toEqual(["listener", "agent", "knowledge", "vault", "db"]);
  });

  it("keeps going after a step throws, and names the one that failed", async () => {
    const log: string[] = [];
    const failures: string[] = [];
    const boom = new Error("socket refused to close");
    const shutdown = createGracefulShutdown({
      onTimeout: () => {},
      onStepFailed: (name) => failures.push(name),
      timeoutMs: 1_000,
      steps: [
        {
          name: "listener",
          run: () => {
            log.push("listener");
            return Promise.reject(boom);
          },
        },
        recordingStep("vault", log),
      ],
    });

    await shutdown.run();

    expect(failures).toEqual(["listener"]);
    // The pending vault commit is exactly what must survive a failed close.
    expect(log).toEqual(["listener", "vault"]);
  });

  it("is idempotent — a second call joins the first run", async () => {
    const log: string[] = [];
    const shutdown = createGracefulShutdown({
      ...quiet,
      timeoutMs: 1_000,
      steps: [recordingStep("vault", log)],
    });

    await Promise.all([shutdown.run(), shutdown.run(), shutdown.run()]);

    expect(log).toEqual(["vault"]);
  });

  it("reports `started` only once run has been called", () => {
    const shutdown = createGracefulShutdown({ ...quiet, timeoutMs: 1_000, steps: [] });
    expect(shutdown.started).toBe(false);
    void shutdown.run();
    expect(shutdown.started).toBe(true);
  });

  it("resolves through the deadline when a step never settles", async () => {
    vi.useFakeTimers();
    try {
      let timedOut = false;
      const shutdown = createGracefulShutdown({
        onStepFailed: () => {},
        onTimeout: () => {
          timedOut = true;
        },
        timeoutMs: 5_000,
        steps: [{ name: "wedged", run: () => new Promise<void>(() => {}) }],
      });

      const settled = shutdown.run();
      await vi.advanceTimersByTimeAsync(5_000);
      await settled;

      expect(timedOut).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

function fakeTarget() {
  const handlers = new Map<NodeJS.Signals, () => void>();
  const exits: number[] = [];
  return {
    exits,
    raise(signal: NodeJS.Signals) {
      handlers.get(signal)?.();
    },
    registered: () => [...handlers.keys()],
    target: {
      on(signal: NodeJS.Signals, handler: () => void) {
        handlers.set(signal, handler);
      },
      exit(code: number) {
        exits.push(code);
      },
    },
  };
}

describe("installShutdownSignals", () => {
  it("tears down and exits 0 on the first signal", async () => {
    const log: string[] = [];
    const fake = fakeTarget();
    const shutdown = createGracefulShutdown({
      ...quiet,
      timeoutMs: 1_000,
      steps: [recordingStep("vault", log)],
    });

    installShutdownSignals({ shutdown, target: fake.target, onImpatient: () => {} });
    expect(fake.registered()).toEqual([...SHUTDOWN_SIGNALS]);

    fake.raise("SIGTERM");
    await shutdown.run();
    await Promise.resolve();

    expect(log).toEqual(["vault"]);
    expect(fake.exits).toEqual([0]);
  });

  it("treats a second signal as impatience, not a second teardown", async () => {
    const log: string[] = [];
    const impatient: NodeJS.Signals[] = [];
    const fake = fakeTarget();
    const shutdown = createGracefulShutdown({
      ...quiet,
      timeoutMs: 1_000,
      steps: [recordingStep("vault", log)],
    });

    installShutdownSignals({
      shutdown,
      target: fake.target,
      onImpatient: (signal) => impatient.push(signal),
    });

    fake.raise("SIGINT");
    fake.raise("SIGINT");
    await shutdown.run();

    expect(log).toEqual(["vault"]);
    expect(impatient).toEqual(["SIGINT"]);
  });
});
