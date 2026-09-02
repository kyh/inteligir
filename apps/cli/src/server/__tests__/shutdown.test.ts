import type { DbConnection } from "@repo/db/connection";
import { describe, expect, it, vi } from "vitest";
import { registerListener } from "../compose";
import { bootTestApp } from "./boot-app";
import {
  createGracefulShutdown,
  FATAL_EVENTS,
  installFatalErrorHandlers,
  installShutdownSignals,
  SHUTDOWN_SIGNALS,
  SHUTDOWN_TIMEOUT_MS,
  shutdownDeadlineMs,
  TEARDOWN_BUDGETS_MS,
  type FatalEvent,
  type ShutdownStep,
} from "../shutdown";

function wedgedStep(name: string, timeoutMs: number): ShutdownStep {
  return { name, timeoutMs, run: () => new Promise<void>(() => {}) };
}

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

describe("createGracefulShutdown", () => {
  it("runs the steps in declaration order", async () => {
    const log: string[] = [];
    const shutdown = createGracefulShutdown({
      ...quiet,
      steps: [
        recordingStep("listener", log),
        recordingStep("agent", log),
        recordingStep("knowledge", log),
        recordingStep("vault", log),
        recordingStep("db", log),
      ],
    });

    await expect(shutdown.run()).resolves.toEqual({ ok: true, failed: [] });
    expect(log).toEqual(["listener", "agent", "knowledge", "vault", "db"]);
  });

  it("keeps going after a step throws, and names the one that failed", async () => {
    const log: string[] = [];
    const failures: string[] = [];
    const shutdown = createGracefulShutdown({
      onTimeout: () => {},
      onStepFailed: (name) => failures.push(name),
      steps: [
        {
          name: "listener",
          run: () => Promise.reject(new Error("socket refused to close")),
        },
        recordingStep("vault", log),
      ],
    });

    await expect(shutdown.run()).resolves.toEqual({ ok: false, failed: ["listener"] });
    expect(failures).toEqual(["listener"]);
    expect(log).toEqual(["vault"]);
  });

  it("TIME-BOXES EACH STEP, so a wedged one cannot starve the rest", async () => {
    vi.useFakeTimers();
    try {
      const log: string[] = [];
      const shutdown = createGracefulShutdown({
        ...quiet,
        steps: [
          { name: "listener", timeoutMs: 1_000, run: () => new Promise<void>(() => {}) },
          recordingStep("agent", log),
          recordingStep("vault", log),
          recordingStep("db", log),
        ],
      });

      const settled = shutdown.run();
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(settled).resolves.toEqual({ ok: false, failed: ["listener"] });
      expect(log).toEqual(["agent", "vault", "db"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a step's own budget in the failure it reports", async () => {
    vi.useFakeTimers();
    try {
      const errors: string[] = [];
      const shutdown = createGracefulShutdown({
        onTimeout: () => {},
        onStepFailed: (_name, error) => errors.push(error instanceof Error ? error.message : ""),
        steps: [{ name: "vault", timeoutMs: 2_500, run: () => new Promise<void>(() => {}) }],
      });
      const settled = shutdown.run();
      await vi.advanceTimersByTimeAsync(2_500);
      await settled;
      expect(errors).toEqual(["vault did not finish within 2500ms"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent — a second call joins the first run", async () => {
    const log: string[] = [];
    const shutdown = createGracefulShutdown({
      ...quiet,
      steps: [recordingStep("vault", log)],
    });

    await Promise.all([shutdown.run(), shutdown.run(), shutdown.run()]);

    expect(log).toEqual(["vault"]);
  });

  it("reports `started` only once run has been called", () => {
    const shutdown = createGracefulShutdown({ ...quiet, steps: [] });
    expect(shutdown.started).toBe(false);
    void shutdown.run();
    expect(shutdown.started).toBe(true);
  });

  it("DERIVES the sequence deadline, so no step is starved by the backstop", async () => {
    vi.useFakeTimers();
    try {
      const steps = [
        wedgedStep("listener", 5_000),
        wedgedStep("agent", 5_000),
        wedgedStep("knowledge", 5_000),
        wedgedStep("vault", 8_000),
        wedgedStep("db", 5_000),
      ];
      let timedOut = false;
      const shutdown = createGracefulShutdown({
        onStepFailed: () => {},
        onTimeout: () => {
          timedOut = true;
        },
        steps,
      });

      const settled = shutdown.run();
      await vi.advanceTimersByTimeAsync(shutdownDeadlineMs(steps));
      await expect(settled).resolves.toEqual({
        ok: false,
        failed: ["listener", "agent", "knowledge", "vault", "db"],
      });
      expect(timedOut).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the deadline at RUN time, from the steps registered by then", async () => {
    vi.useFakeTimers();
    try {
      const steps: ShutdownStep[] = [];
      const shutdown = createGracefulShutdown({ ...quiet, steps });
      steps.push({ name: "vault", timeoutMs: 8_000, run: () => new Promise<void>(() => {}) });

      const settled = shutdown.run();
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(settled).resolves.toEqual({ ok: false, failed: ["vault"] });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the exported ceiling", () => {
  it("covers every step budget the process can register", () => {
    const declared = Object.values(TEARDOWN_BUDGETS_MS).reduce((total, ms) => total + ms, 0);
    // the supervisor's SIGKILL grace derives from this; a ceiling under the sum kills the process mid-step.
    expect(SHUTDOWN_TIMEOUT_MS).toBeGreaterThan(declared);
  });
});

describe("installShutdownSignals", () => {
  it("tears down and exits 0 on the first signal", async () => {
    const log: string[] = [];
    const fake = fakeTarget();
    const shutdown = createGracefulShutdown({ ...quiet, steps: [recordingStep("vault", log)] });

    installShutdownSignals({
      shutdown,
      target: fake.target,
      onImpatient: () => {},
      onUncleanExit: () => {},
    });
    expect(fake.registered()).toEqual([...SHUTDOWN_SIGNALS]);

    fake.raise("SIGTERM");
    await shutdown.run();
    await Promise.resolve();

    expect(log).toEqual(["vault"]);
    expect(fake.exits).toEqual([0]);
  });

  it("EXITS NON-ZERO when a step failed, and says which", async () => {
    const fake = fakeTarget();
    const reported: string[][] = [];
    const shutdown = createGracefulShutdown({
      ...quiet,
      steps: [{ name: "db", run: () => Promise.reject(new Error("disk I/O error")) }],
    });

    installShutdownSignals({
      shutdown,
      target: fake.target,
      onImpatient: () => {},
      onUncleanExit: (failed) => reported.push([...failed]),
    });

    fake.raise("SIGTERM");
    await shutdown.run();
    await Promise.resolve();

    expect(reported).toEqual([["db"]]);
    expect(fake.exits).toEqual([1]);
  });

  it("treats a second signal as impatience, not a second teardown", async () => {
    const log: string[] = [];
    const impatient: NodeJS.Signals[] = [];
    const fake = fakeTarget();
    const shutdown = createGracefulShutdown({ ...quiet, steps: [recordingStep("vault", log)] });

    installShutdownSignals({
      shutdown,
      target: fake.target,
      onImpatient: (signal) => impatient.push(signal),
      onUncleanExit: () => {},
    });

    fake.raise("SIGINT");
    fake.raise("SIGINT");
    await shutdown.run();

    expect(log).toEqual(["vault"]);
    expect(impatient).toEqual(["SIGINT"]);
  });
});

function fakeFatalTarget() {
  const handlers = new Map<FatalEvent, (cause: unknown) => void>();
  const exits: number[] = [];
  return {
    exits,
    raise(event: FatalEvent, cause: unknown) {
      handlers.get(event)?.(cause);
    },
    registered: () => [...handlers.keys()],
    target: {
      on(event: FatalEvent, handler: (cause: unknown) => void) {
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
    const log: string[] = [];
    const seen: Array<{ event: FatalEvent; reason: unknown }> = [];
    const fake = fakeFatalTarget();
    const shutdown = createGracefulShutdown({
      ...quiet,
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
    expect(fake.exits).toEqual([1]);
  });

  it("joins the teardown a signal already started rather than racing it", async () => {
    const log: string[] = [];
    const fake = fakeFatalTarget();
    const shutdown = createGracefulShutdown({
      ...quiet,
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

describe("the composed teardown", () => {
  it("holds every budgeted step in the budgets table's order once the listener joins", async () => {
    const { composed } = await bootTestApp();
    registerListener(composed.teardown, () => Promise.resolve());
    expect(
      composed.teardown.map((step) => step.name),
      "compose.ts must register every step TEARDOWN_BUDGETS_MS budgets in the table's own order (it is written in teardown order), and registerListener must put the one step only a bound port can add at the FRONT — the listener closes the sockets before the vault flush behind it",
    ).toEqual(Object.keys(TEARDOWN_BUDGETS_MS));
  });

  it("carries each step's budget from the one table", async () => {
    const { composed } = await bootTestApp();
    const budgets: Record<string, number> = TEARDOWN_BUDGETS_MS;
    for (const step of composed.teardown) {
      expect(
        step.timeoutMs,
        `compose.ts step "${step.name}" must carry the budget TEARDOWN_BUDGETS_MS assigns that name — a step cannot arrive with a number of its own`,
      ).toBe(budgets[step.name]);
    }
  });

  // two tests in order: the harness's afterEach runs between them, and the second observes what it released.
  describe.sequential("a boot the driver dial refuses", () => {
    let db: DbConnection | null = null;

    it("rejects with the refusal, its database open at that moment", async () => {
      await expect(
        bootTestApp({
          makeDriver: (deps) => {
            db = deps.db;
            throw new Error("driver refused");
          },
        }),
      ).rejects.toThrow("driver refused");
      expect(db?.$client.open).toBe(true);
    });

    it("has released what came up before the refusal", () => {
      expect(
        db?.$client.open,
        "boot-app.ts must register the composed teardown over the LIVE steps array BEFORE composing — a compose that throws after the database opened otherwise leaks its handle for the rest of the worker",
      ).toBe(false);
    });
  });
});
