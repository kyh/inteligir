import { describe, expect, it } from "vitest";
import { openScope } from "./scope";
import type { ScopeOutput } from "./scope";
import type { TrackedProcess } from "./tracked-child";

const recorded = (): ScopeOutput & { readonly lines: string[] } => {
  const lines: string[] = [];
  return {
    err: (message) => {
      lines.push(`err ${message}`);
    },
    lines,
    out: (message) => {
      lines.push(`out ${message}`);
    },
  };
};

const instance = (
  name: string,
  stops: string[],
  options: { readonly fails?: boolean; readonly tail?: string } = {},
): TrackedProcess => ({
  name,
  outputTail: () => options.tail ?? "",
  stop: async () => {
    await Promise.resolve();
    stops.push(name);
    if (options.fails === true) {
      throw new Error(`${name} survived SIGKILL`);
    }
  },
});

describe("a run's scope", () => {
  it("stops what it owns at close, the last started first", async () => {
    const stops: string[] = [];
    const scope = openScope(recorded());
    scope.own(instance("worker", stops));
    scope.own(instance("browser", stops));
    await expect(scope.close()).resolves.toBe(true);
    expect(stops).toStrictEqual(["browser", "worker"]);
  });

  it("stops the rest past a stop that failed, and closes unclean", async () => {
    const stops: string[] = [];
    const output = recorded();
    const scope = openScope(output);
    scope.own(instance("worker", stops));
    scope.own(instance("browser", stops, { fails: true }));
    await expect(scope.close()).resolves.toBe(false);
    expect(stops).toStrictEqual(["browser", "worker"]);
    expect(output.lines).toStrictEqual(["err teardown: browser survived SIGKILL"]);
  });

  it("answers a close asked again with the first one's verdict, stopping nothing twice", async () => {
    const stops: string[] = [];
    const scope = openScope(recorded());
    scope.own(instance("worker", stops, { fails: true }));
    const [first, second] = await Promise.all([scope.close(), scope.close()]);
    await expect(scope.close()).resolves.toBe(false);
    expect([first, second, stops]).toStrictEqual([false, false, ["worker"]]);
  });

  it("refuses a line once the teardown began, and writes nothing of it", async () => {
    const output = recorded();
    const scope = openScope(output);
    scope.log("before");
    const closing = scope.close();
    expect(() => {
      scope.log("while closing");
    }).toThrow("after the teardown began");
    await closing;
    expect(() => {
      scope.log("after");
    }).toThrow("after the teardown began");
    expect(output.lines).toStrictEqual(["out before"]);
  });

  it("stops and refuses a start once the teardown began", async () => {
    const stops: string[] = [];
    const scope = openScope(recorded());
    await scope.close();
    expect(() => {
      scope.own(instance("late browser", stops));
    }).toThrow("late browser started after the teardown began");
    await expect.poll(() => stops).toStrictEqual(["late browser"]);
    await expect(scope.close()).resolves.toBe(true);
  });

  it("reports the output each owned instance wrote, and none it did not", () => {
    const stops: string[] = [];
    const scope = openScope(recorded());
    scope.own(instance("quiet", stops));
    scope.own(instance("worker", stops, { tail: "listening" }));
    expect(scope.tails()).toBe('--- instance "worker" output tail ---\nlistening');
  });
});
