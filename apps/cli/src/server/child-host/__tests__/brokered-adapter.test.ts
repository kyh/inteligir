import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { text } from "node:stream/consumers";
import { createAcpAgentRuntime } from "@repo/agent-runtime/acp/acp-runtime";
import type { ProviderEvent } from "@repo/agent-runtime/vocabulary/provider-event";
import { describe, expect, it, vi } from "vitest";
import { brokeredAdapterProcess } from "../brokered-adapter";
import type { BrokeredFork } from "../fork-broker-client";
import { stdioOverPort, toChildFrameSchema } from "../stdio-frames";
import type { ToChildFrame } from "../stdio-frames";
import { fakeChannel, manualFork } from "./fake-ports";

const require = createRequire(import.meta.url);
const FAKE_AGENT = require.resolve("@repo/agent-runtime/test-support/fake-acp-agent");

const noSignal = (): void => {
  /* empty */
};

// what reaches the child's end of the channel: stdin is a byte stream, so frames may merge
interface ChildInbox {
  text: string;
  ended: boolean;
}

const childInbox = (port: ReturnType<typeof fakeChannel>["port2"]): ChildInbox => {
  const inbox: ChildInbox = { ended: false, text: "" };
  port.on("message", ({ data }) => {
    const parsed = toChildFrameSchema.safeParse(data);
    if (!parsed.success) {
      return;
    }
    const frame: ToChildFrame = parsed.data;
    if (frame.kind === "stdin") {
      expect(inbox.ended).toBe(false);
      inbox.text += new TextDecoder().decode(frame.chunk);
    } else {
      inbox.ended = true;
    }
  });
  port.start();
  return inbox;
};

// stands in for main and the stdio host: node forks the fake agent, and its stdio rides the
// child's end of the channel the way the host entry carries a real adapter's.
const brokeredFakeAgent = (mode: string): BrokeredFork => {
  const { attach, exit, fork } = manualFork();
  const { port1, port2 } = fakeChannel();
  const agent = spawn(process.execPath, [FAKE_AGENT], {
    env: { ...process.env, FAKE_ACP_MODE: mode },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdio = stdioOverPort(port2);
  stdio.stdin.pipe(agent.stdin);
  agent.stdout.pipe(stdio.stdout);
  agent.stderr.pipe(stdio.stderr);
  agent.once("spawn", () => {
    attach(
      agent.pid === undefined
        ? { kind: "failed", message: "no pid" }
        : { kind: "attached", pid: agent.pid, port: port1 },
    );
  });
  agent.once("exit", (code) => {
    exit(code);
  });
  // after the streams drain, as a dead child's port closes after its last frame
  agent.once("close", () => {
    port2.close();
  });
  return fork;
};

describe("a brokered adapter process", () => {
  it("holds stdin until main attaches the child, then delivers it in order", async () => {
    const { attach, fork } = manualFork();
    const adapter = brokeredAdapterProcess(fork, noSignal);
    adapter.stdin.write("first\n");
    adapter.stdin.write("second\n");
    const { port1, port2 } = fakeChannel();
    const inbox = childInbox(port2);
    expect(inbox).toEqual({ ended: false, text: "" });
    attach({ kind: "attached", pid: 11, port: port1 });
    adapter.stdin.end();
    await vi.waitFor(() => {
      expect(inbox).toEqual({ ended: true, text: "first\nsecond\n" });
    });
  });

  it("surfaces the child's stdout and stderr, ending both when the port closes", async () => {
    const { attach, fork } = manualFork();
    const adapter = brokeredAdapterProcess(fork, noSignal);
    const { port1, port2 } = fakeChannel();
    attach({ kind: "attached", pid: 11, port: port1 });
    const stdio = stdioOverPort(port2);
    stdio.stdout.write("to stdout");
    stdio.stderr.write("to stderr");
    await vi.waitFor(() => {
      expect(adapter.stdout.readableLength).toBeGreaterThan(0);
    });
    port2.close();
    expect(await text(adapter.stdout)).toBe("to stdout");
    expect(await text(adapter.stderr)).toBe("to stderr");
  });

  it("exits with the code main saw, and refuses a kill after it", async () => {
    const { exit, fork } = manualFork();
    const adapter = brokeredAdapterProcess(fork, noSignal);
    const exited = Promise.withResolvers<[number | null, NodeJS.Signals | null]>();
    adapter.once("exit", (code, signal) => {
      exited.resolve([code, signal]);
    });
    exit(0);
    expect(await exited.promise).toEqual([0, null]);
    expect(adapter.exitCode).toBe(0);
    expect(adapter.kill("SIGTERM")).toBe(false);
  });

  it("lands a kill asked for before main named the pid once it has", async () => {
    const { attach, fork } = manualFork();
    const signals: [number, NodeJS.Signals][] = [];
    const adapter = brokeredAdapterProcess(fork, (pid, signal) => {
      signals.push([pid, signal]);
    });
    expect(adapter.kill("SIGTERM")).toBe(true);
    expect(signals).toEqual([]);
    attach({ kind: "attached", pid: 77, port: fakeChannel().port1 });
    await vi.waitFor(() => {
      expect(signals).toEqual([[77, "SIGTERM"]]);
    });
  });

  it("says on stderr why main could not start it", async () => {
    const { attach, exit, fork } = manualFork();
    const adapter = brokeredAdapterProcess(fork, noSignal);
    attach({ kind: "failed", message: "no such module" });
    exit(null);
    expect(await text(adapter.stderr)).toContain("no such module");
  });

  it("carries a whole ACP session and turn through the channel", async () => {
    const events: ProviderEvent[] = [];
    const runtime = createAcpAgentRuntime({
      onEvent: (event) => {
        events.push(event);
      },
      spawnAdapter: () => ({ child: brokeredAdapterProcess(brokeredFakeAgent("message")) }),
      workspacePath: process.cwd(),
    });
    await runtime.startThread({ providerId: "claude", threadId: "thr_brokered" });
    await runtime.runTurn({ input: [{ text: "hi", type: "text" }], threadId: "thr_brokered" });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "turn/completed")).toBe(true);
    });
    await runtime.shutdown();
    expect(JSON.stringify(events)).toContain("from the fake agent");
  });

  it("names a crash before the handshake from the child's own stderr", async () => {
    const runtime = createAcpAgentRuntime({
      onEvent: () => {
        /* empty */
      },
      spawnAdapter: () => ({ child: brokeredAdapterProcess(brokeredFakeAgent("crashOnBoot")) }),
      workspacePath: process.cwd(),
    });
    await expect(
      runtime.startThread({ providerId: "claude", threadId: "thr_crash" }),
    ).rejects.toThrow(/adapter exited \(code 3\): fake agent: cannot start/u);
    await runtime.shutdown();
  });
});
