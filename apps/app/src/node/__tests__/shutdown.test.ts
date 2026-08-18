import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
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

    // The pending vault commit is exactly what must survive a failed close —
    // and the exit code must still say the shutdown was not clean.
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
          // The blocker's shape: one open websocket leaves the listener close
          // pending forever. Everything after it is what a graceful shutdown
          // exists for.
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
    // A whole-sequence total written as its own number is the bug: every step
    // behind the point it expires is skipped — and the order puts the vault
    // flush last on purpose. Five wedged steps must each cost their own
    // budget and be NAMED, not be cut off by the deadline that bounds them.
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
    // The boot fills the array as its resources come up, so a deadline taken
    // at construction would bound an empty sequence.
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
    // The supervisor's SIGKILL grace derives from this; a ceiling under the
    // sum kills the process during whatever the order put last.
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
    // A failed final commit or a database that would not close is not a clean
    // shutdown; reporting 0 teaches every supervisor above to believe a lie.
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

// ---------------------------------------------------------------------------
// The boot's registration order against the budgets table.
//
// `main.ts` claims its `unshift` yields "exactly the teardown order shutdown.ts
// states", and `shutdown.ts` writes that order out in prose above a table that
// is ALSO in that order. Three artifacts, one fact, and nothing held them
// together — the `cloud` step went in and both comments kept saying five.
//
// So the order is DERIVED from the two places it is real: the sequence of
// `registerTeardown` calls in the boot, and the key order of the budgets table.
// A step added to one and not the other fails here.
// ---------------------------------------------------------------------------
describe("the boot registers every teardown step, in the budgets table's order", () => {
  const bootSource = readFileSync(fileURLToPath(new URL("../main.ts", import.meta.url)), "utf8");

  /** Every `registerTeardown("<name>", …)` in the boot, in source order — which
   *  IS the order they come up, because each is registered the moment its
   *  resource exists. */
  function registeredInBootOrder(): string[] {
    return [...bootSource.matchAll(/registerTeardown\(\s*"([a-z]+)"/gu)].map((match) => {
      const name = match[1];
      if (name === undefined) {
        throw new Error("unreachable: the capture group is required");
      }
      return name;
    });
  }

  it("registers each budgeted step exactly once", () => {
    expect(registeredInBootOrder().toSorted()).toEqual(Object.keys(TEARDOWN_BUDGETS_MS).toSorted());
  });

  it("tears down in the reverse of the order things came up", () => {
    // `registerTeardown` unshifts, so the teardown sequence is the reverse of
    // the boot's registrations — and the budgets table is written in teardown
    // order, which is what makes reading the two side by side honest.
    expect(registeredInBootOrder().toReversed()).toEqual(Object.keys(TEARDOWN_BUDGETS_MS));
  });
});
