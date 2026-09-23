import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerProcess, STOP_GRACE_MS } from "../server-process";
import type { ServerChild, ServerProcess, ServerProcessArgs } from "../server-process";

class FakeChild implements ServerChild {
  readonly pid = 4242;
  readonly stdout = null;
  readonly stderr = null;
  terms = 0;
  #exitListeners: ((code: number) => void)[] = [];

  kill(): boolean {
    this.terms += 1;
    return true;
  }

  once(_event: "exit", listener: (code: number) => void): void {
    this.#exitListeners.push(listener);
  }

  exit(code: number): void {
    const listeners = this.#exitListeners;
    this.#exitListeners = [];
    for (const listener of listeners) {
      listener(code);
    }
  }
}

interface Harness {
  child: FakeChild;
  server: ServerProcess;
  forks: string[][];
  unexpectedExits: (number | null)[];
}

const harness = (
  isReady: ServerProcessArgs["isReady"] = async () => await Promise.resolve(true),
): Harness => {
  const child = new FakeChild();
  const forks: string[][] = [];
  const unexpectedExits: (number | null)[] = [];
  const server = createServerProcess({
    entryPath: "/app/node_modules/inteligir/dist/index.js",
    env: { INTELIGIR_DATA_DIR: "/data" },
    fork: (modulePath, args) => {
      forks.push([modulePath, ...args]);
      return child;
    },
    isReady,
    log: () => {},
    onUnexpectedExit: (code) => {
      unexpectedExits.push(code);
    },
  });
  return { child, forks, server, unexpectedExits };
};

const settledFlag = (promise: Promise<void>): (() => boolean) => {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  return () => settled;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createServerProcess", () => {
  it("forks the CLI's bundle with one argument, serve", async () => {
    const { forks, server } = harness();
    await server.start();
    expect(forks).toEqual([["/app/node_modules/inteligir/dist/index.js", "serve"]]);
  });

  it("stops as soon as the child exits, with no polling step behind it", async () => {
    vi.useFakeTimers();
    const { child, server } = harness();
    await server.start();

    const stopped = settledFlag(server.stop());
    expect(child.terms).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped()).toBe(false);

    child.exit(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped(), "an exit must end the wait on its own, not on the next tick of a clock").toBe(
      true,
    );
  });

  it("sends SIGKILL only once the grace has run out, and waits for the exit it causes", async () => {
    vi.useFakeTimers();
    const kills = vi.spyOn(process, "kill").mockImplementation(() => true);
    const { child, server } = harness();
    await server.start();

    const stopped = settledFlag(server.stop());
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - 1);
    expect(kills).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(kills).toHaveBeenCalledWith(child.pid, "SIGKILL");
    expect(stopped()).toBe(false);

    child.exit(137);
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped()).toBe(true);
  });

  it("never reports the exit stop asked for as unexpected", async () => {
    const { child, server, unexpectedExits } = harness();
    await server.start();
    const stopped = server.stop();
    child.exit(0);
    await stopped;
    expect(unexpectedExits).toEqual([]);
  });

  it("reports an exit nobody asked for once the child was ready, and has nothing left to stop", async () => {
    const { child, server, unexpectedExits } = harness();
    await server.start();
    child.exit(1);
    expect(unexpectedExits).toEqual([1]);
    await server.stop();
    expect(child.terms).toBe(0);
  });

  it("rejects start when the child exits before it is ready, even mid-probe", async () => {
    const pendingProbe = Promise.withResolvers<boolean>();
    const { child, server, unexpectedExits } = harness(async () => await pendingProbe.promise);
    const started = server.start();
    child.exit(1);
    await expect(started).rejects.toThrow(/exited before it was ready/u);
    expect(unexpectedExits).toEqual([]);
  });
});
