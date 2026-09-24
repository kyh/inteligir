import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import type { PortMessageEvent } from "../../child-host/message-port";
import { fakeChannel, manualFork } from "../../child-host/__tests__/fake-ports";
import type { ChildToParentMessage } from "../watcher/messages";
import { createPortChannel } from "../watcher/port-channel";

// past every microtask, so an attachment already resolved has been taken up
const settled = async (): Promise<void> => {
  await setImmediate();
};

describe("the watcher channel main forks through the broker", () => {
  it("delivers the child's messages once attached, dropping any it cannot parse", async () => {
    const { attach, fork } = manualFork();
    const channel = createPortChannel(fork, () => {
      /* empty */
    });
    const received: ChildToParentMessage[] = [];
    channel.onMessage((message) => {
      received.push(message);
    });
    const { port1, port2 } = fakeChannel();
    attach({ kind: "attached", pid: 5, port: port1 });
    port1.receive({ data: { kind: "nonsense" }, ports: [] });
    port2.postMessage({ kind: "ready" });
    await vi.waitFor(() => {
      expect(received).toEqual([{ kind: "ready" }]);
    });
  });

  it("drops a send made before the port arrives, and delivers one made after", async () => {
    const { attach, fork } = manualFork();
    const channel = createPortChannel(fork, () => {
      /* empty */
    });
    const { port1, port2 } = fakeChannel();
    const inbox: PortMessageEvent["data"][] = [];
    port2.on("message", ({ data }) => {
      inbox.push(data);
    });
    port2.start();
    channel.send({ kind: "ping" });
    attach({ kind: "attached", pid: 5, port: port1 });
    await settled();
    channel.send({ id: "sub_1", kind: "unsubscribe" });
    expect(inbox).toEqual([{ id: "sub_1", kind: "unsubscribe" }]);
  });

  it("reports the child gone once, whether main's exit report or the closed port says so first", async () => {
    const { attach, exit, fork } = manualFork();
    const channel = createPortChannel(fork, () => {
      /* empty */
    });
    let exits = 0;
    channel.onExit(() => {
      exits += 1;
    });
    const { port1, port2 } = fakeChannel();
    attach({ kind: "attached", pid: 5, port: port1 });
    await settled();
    port2.close();
    expect(exits).toBe(1);
    exit(137);
    await settled();
    expect(exits).toBe(1);
  });

  it("reports a fork main could not start as a child gone", async () => {
    const { attach, fork } = manualFork();
    const channel = createPortChannel(fork, () => {
      /* empty */
    });
    const gone = Promise.withResolvers<"gone">();
    channel.onExit(() => {
      gone.resolve("gone");
    });
    attach({ kind: "failed", message: "no such module" });
    await expect(gone.promise).resolves.toBe("gone");
  });

  it("sigkills by pid, holding a kill asked for before main named it", async () => {
    const { attach, fork } = manualFork();
    const signals: [number, NodeJS.Signals][] = [];
    const channel = createPortChannel(fork, (pid, signal) => {
      signals.push([pid, signal]);
    });
    channel.kill();
    expect(signals).toEqual([]);
    attach({ kind: "attached", pid: 9, port: fakeChannel().port1 });
    await settled();
    expect(signals).toEqual([[9, "SIGKILL"]]);
  });
});
