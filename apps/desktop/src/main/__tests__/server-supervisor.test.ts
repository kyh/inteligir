// The supervisor is driven with a fake child and a fake clock: every path
// below is one the shipped shell takes on a user's machine, and none of them
// can be reached from a test that spawns a real process.

import { describe, expect, it } from "vitest";
import {
  createSupervisor,
  restartDelayMs,
  type SupervisedChild,
  type SupervisorLimits,
} from "../server-supervisor";

const LIMITS: SupervisorLimits = {
  bootTimeoutMs: 1_000,
  bootProbeIntervalMs: 100,
  livenessIntervalMs: 1_000,
  livenessFailuresBeforeRestart: 2,
  restartDelaysMs: [10, 20],
  maxConsecutiveRestarts: 2,
  stopGraceMs: 200,
};

class FakeChild implements SupervisedChild {
  readonly pid = 1234;
  readonly signals: NodeJS.Signals[] = [];
  private listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    // A real SIGKILL always ends the process; SIGTERM is what the harness
    // decides, so the graceful path can be tested from both sides.
    if (signal === "SIGKILL") {
      this.exit(null, "SIGKILL");
    }
    return true;
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.listener = listener;
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    const listener = this.listener;
    this.listener = null;
    listener?.(code, signal);
  }
}

interface Harness {
  children: FakeChild[];
  logs: string[];
  ticks: (() => void)[];
  healthy: boolean;
}

function makeHarness(healthy: boolean) {
  const harness: Harness = { children: [], logs: [], ticks: [], healthy };
  const supervisor = createSupervisor(
    {
      spawnServer: () => {
        const child = new FakeChild();
        harness.children.push(child);
        return child;
      },
      probeHealth: () => Promise.resolve(harness.healthy),
      // Zero-delay: the ordering under test is causal, not wall-clock.
      delay: () => Promise.resolve(),
      schedule: (_intervalMs, tick) => {
        harness.ticks.push(tick);
        return () => {
          harness.ticks = harness.ticks.filter((entry) => entry !== tick);
        };
      },
      log: (message) => harness.logs.push(message),
    },
    LIMITS,
  );
  return { harness, supervisor };
}

/** Let queued microtasks (the supervisor's async chains) run to quiescence. */
async function settle(): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
  }
}

describe("restartDelayMs", () => {
  it("walks the table and then repeats its last entry", () => {
    expect(restartDelayMs([10, 20, 30], 1)).toBe(10);
    expect(restartDelayMs([10, 20, 30], 3)).toBe(30);
    expect(restartDelayMs([10, 20, 30], 9)).toBe(30);
  });

  it("is zero with no table", () => {
    expect(restartDelayMs([], 1)).toBe(0);
  });
});

describe("createSupervisor", () => {
  it("spawns one child and reports up once health answers", async () => {
    const { harness, supervisor } = makeHarness(true);
    await supervisor.start();
    expect(harness.children).toHaveLength(1);
    expect(supervisor.state).toEqual({ kind: "up" });
  });

  it("fails, and kills the child, when the server never answers", async () => {
    const { harness, supervisor } = makeHarness(false);
    await expect(supervisor.start()).rejects.toThrow(/did not answer/u);
    expect(supervisor.state.kind).toBe("failed");
    expect(harness.children[0]?.signals).toContain("SIGKILL");
  });

  it("restarts a crashed child and comes back up", async () => {
    const { harness, supervisor } = makeHarness(true);
    await supervisor.start();

    harness.children[0]?.exit(1, null);
    await settle();

    expect(harness.children).toHaveLength(2);
    expect(supervisor.state).toEqual({ kind: "up" });
    expect(harness.logs.some((line) => line.includes("server exited"))).toBe(true);
  });

  it("gives up after the restart budget, rather than looping forever", async () => {
    const { harness, supervisor } = makeHarness(true);
    await supervisor.start();
    harness.healthy = false;

    harness.children[0]?.exit(1, null);
    await settle();

    expect(supervisor.state).toEqual({
      kind: "failed",
      reason: "the server failed to stay up after 2 restarts",
    });
  });

  it("kills a wedged server after enough missed liveness probes", async () => {
    const { harness, supervisor } = makeHarness(true);
    await supervisor.start();
    const first = harness.children[0];
    harness.healthy = false;

    // One miss is a busy moment, not a dead server.
    harness.ticks[0]?.();
    await settle();
    expect(first?.signals ?? []).not.toContain("SIGKILL");

    harness.ticks[0]?.();
    await settle();
    expect(first?.signals).toContain("SIGKILL");
    expect(harness.logs.some((line) => line.includes("missed 2 health probes"))).toBe(true);
  });

  it("stops with SIGTERM, so the server flushes rather than dying mid-commit", async () => {
    const { harness, supervisor } = makeHarness(true);
    await supervisor.start();
    const child = harness.children[0];

    const stopped = supervisor.stop();
    expect(child?.signals).toEqual(["SIGTERM"]);
    child?.exit(0, null);
    await stopped;

    expect(child?.signals).toEqual(["SIGTERM"]);
    expect(supervisor.state).toEqual({ kind: "stopped" });
    expect(harness.children).toHaveLength(1);
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const { harness, supervisor } = makeHarness(true);
    await supervisor.start();
    const child = harness.children[0];

    await supervisor.stop();

    expect(child?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(supervisor.state).toEqual({ kind: "stopped" });
  });

  it("does not restart a child that exited because the shell asked it to", async () => {
    const { harness, supervisor } = makeHarness(true);
    await supervisor.start();
    await supervisor.stop();
    await settle();
    expect(harness.children).toHaveLength(1);
  });
});
