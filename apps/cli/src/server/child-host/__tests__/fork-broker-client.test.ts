import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createForkBrokerClient } from "../fork-broker-client";
import type { ForkSpec } from "../fork-broker-client";
import { fakeChannel, fakeParentPort } from "./fake-ports";

const WATCHER_SPEC: ForkSpec = {
  args: [],
  env: { PATH: "/bin" },
  modulePath: "/app/dist/parcel-watcher-child.mjs",
  serviceName: "inteligir-watcher",
};

const SPEC: ForkSpec = {
  args: ["/app/adapter.js"],
  cwd: "/vault",
  env: { PATH: "/bin" },
  modulePath: "/app/dist/stdio-port-host.mjs",
  serviceName: "inteligir-agent-claude",
};

const UNSETTLED = Symbol("unsettled");

// past every microtask: a promise its frame already settled has settled by then
const settledValue = async <T>(promise: Promise<T>): Promise<T | typeof UNSETTLED> =>
  await Promise.race([promise, setImmediate(UNSETTLED)]);

describe("the server's fork broker client", () => {
  it("asks main for each fork under an id of its own", () => {
    const parent = fakeParentPort();
    const broker = createForkBrokerClient(parent);
    broker.fork(SPEC);
    broker.fork(WATCHER_SPEC);
    expect(parent.posted).toEqual([
      { ...SPEC, id: "fork_1", kind: "fork" },
      { ...WATCHER_SPEC, id: "fork_2", kind: "fork" },
    ]);
  });

  it("attaches the port main forked the child with, then reports its exit", async () => {
    const parent = fakeParentPort();
    const fork = createForkBrokerClient(parent).fork(SPEC);
    const { port1 } = fakeChannel();
    parent.emit({ id: "fork_1", kind: "forked", pid: 4242 }, [port1]);
    expect(await fork.attachment).toEqual({ kind: "attached", pid: 4242, port: port1 });
    expect(await settledValue(fork.exit)).toBe(UNSETTLED);
    parent.emit({ code: 3, id: "fork_1", kind: "exited" });
    expect(await fork.exit).toBe(3);
  });

  it("settles a fork main could not start as failed, never run", async () => {
    const parent = fakeParentPort();
    const fork = createForkBrokerClient(parent).fork(SPEC);
    parent.emit({ id: "fork_1", kind: "fork-failed", message: "no such module" });
    expect(await fork.attachment).toEqual({ kind: "failed", message: "no such module" });
    expect(await fork.exit).toBeNull();
  });

  it("reports a child that exits before it is attached as failed, with its code", async () => {
    const parent = fakeParentPort();
    const fork = createForkBrokerClient(parent).fork(SPEC);
    parent.emit({ code: 1, id: "fork_1", kind: "exited" });
    expect(await fork.attachment).toMatchObject({ kind: "failed" });
    expect(await fork.exit).toBe(1);
  });

  it("ignores a frame it cannot parse, one for no fork it asked for, and a fork with no port", async () => {
    const parent = fakeParentPort();
    const fork = createForkBrokerClient(parent).fork(SPEC);
    parent.emit({ id: "fork_1", kind: "forked" });
    parent.emit({ id: "fork_9", kind: "exited", code: 0 });
    parent.emit("not a frame");
    expect(await settledValue(fork.attachment)).toBe(UNSETTLED);
    parent.emit({ id: "fork_1", kind: "forked", pid: 7 });
    expect(await fork.attachment).toMatchObject({ kind: "failed" });
  });
});
