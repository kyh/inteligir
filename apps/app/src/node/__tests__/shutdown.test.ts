import { describe, expect, it, vi } from "vitest";
import {
  createGracefulShutdown,
  FATAL_EVENTS,
  installFatalErrorHandlers,
  installShutdownSignals,
  SHUTDOWN_SIGNALS,
  type FatalEvent,
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

function fakeFatalTarget() {
  const handlers = new Map<FatalEvent, (reason: unknown) => void>();
  const exits: number[] = [];
  return {
    exits,
    raise(event: FatalEvent, reason: unknown) {
      handlers.get(event)?.(reason);
    },
    registered: () => [...handlers.keys()],
    target: {
      on(event: FatalEvent, handler: (reason: unknown) => void) {
        handlers.set(event, handler);
      },
      exit(code: number) {
        exits.push(code);
      },
    },
  };
}

describe("installFatalErrorHandlers", () => {
  it.each(FATAL_EVENTS)("runs the ordinary teardown for %s, then exits non-zero", async (event) => {
    // Node's default is to print and leave, skipping the SQLite close that
    // checkpoints the WAL sidecar and the vault flush that commits the last
    // edits — so a stray rejection in a background task becomes a data
    // outcome.
    const log: string[] = [];
    const seen: Array<{ event: FatalEvent; reason: unknown }> = [];
    const fake = fakeFatalTarget();
    const shutdown = createGracefulShutdown({
      ...quiet,
      timeoutMs: 1_000,
      steps: [recordingStep("vault", log), recordingStep("db", log)],
    });

    installFatalErrorHandlers({
      shutdown,
      target: fake.target,
      onFatal: (fatalEvent, reason) => seen.push({ event: fatalEvent, reason }),
    });
    expect(fake.registered()).toEqual([...FATAL_EVENTS]);

    const boom = new Error("a background task rejected");
    fake.raise(event, boom);
    await shutdown.run();
    await Promise.resolve();

    expect(seen).toEqual([{ event, reason: boom }]);
    expect(log).toEqual(["vault", "db"]);
    // 1, never 0: a supervisor has to tell a crash from a quit.
    expect(fake.exits).toEqual([1]);
  });

  it("joins the teardown a signal already started rather than racing it", async () => {
    const log: string[] = [];
    const fake = fakeFatalTarget();
    const shutdown = createGracefulShutdown({
      ...quiet,
      timeoutMs: 1_000,
      steps: [recordingStep("vault", log)],
    });

    installFatalErrorHandlers({ shutdown, target: fake.target, onFatal: () => {} });

    void shutdown.run();
    fake.raise("uncaughtException", new Error("boom"));
    await shutdown.run();
    await Promise.resolve();

    expect(log).toEqual(["vault"]);
    expect(fake.exits).toEqual([1]);
  });
});
