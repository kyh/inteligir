import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { ProviderEvent } from "../../vocabulary/provider-event";
import { createAcpAgentRuntime, ThreadClosedError } from "../acp-runtime";
import type { AcpAgentRuntimeOptions } from "../acp-runtime";

const FAKE_AGENT = fileURLToPath(new URL("../../test-support/fake-acp-agent.mjs", import.meta.url));

describe("a running turn's session", () => {
  it("tells the host of every update it sends, one that maps to no event included", async () => {
    const events: ProviderEvent[] = [];
    const activity: string[] = [];
    const runtime = createAcpAgentRuntime({
      onActivity: (threadId) => {
        activity.push(threadId);
      },
      onEvent: (event) => {
        events.push(event);
      },
      spawnAdapter: (_harness, env) =>
        spawn(process.execPath, [FAKE_AGENT], {
          detached: true,
          env: { ...env, FAKE_ACP_MODE: "toolProgress" },
          stdio: ["pipe", "pipe", "pipe"],
        }),
      workspacePath: process.cwd(),
    });
    onTestFinished(async () => {
      await runtime.shutdown();
    });
    await runtime.startThread({ providerId: "codex", threadId: "thr_1" });
    await runtime.runTurn({
      input: [{ text: "find it", type: "text" }],
      threadId: "thr_1",
      turnId: "turn_1",
    });
    await vi.waitFor(() => {
      expect(events.at(-1)?.type).toBe("turn/completed");
    });

    expect(activity).toEqual(["thr_1", "thr_1", "thr_1"]);
    expect(events.map((event) => event.type)).toEqual([
      "turn/started",
      "item/started",
      "item/completed",
      "turn/completed",
    ]);
  });
});

describe("closing a thread", () => {
  it("while an open awaits the previous child's close, leaves no child spawned", async () => {
    const children: ChildProcess[] = [];
    const spawnAdapter: AcpAgentRuntimeOptions["spawnAdapter"] = (_harness, env) => {
      const child = spawn(process.execPath, [FAKE_AGENT], {
        detached: true,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      children.push(child);
      return child;
    };
    const runtime = createAcpAgentRuntime({
      onEvent: () => {
        /* empty */
      },
      spawnAdapter,
      workspacePath: process.cwd(),
    });
    onTestFinished(async () => {
      await runtime.shutdown();
    });
    await runtime.startThread({ providerId: "codex", threadId: "thr_1" });

    // the reopen is parked on the first child's exit when the close lands.
    const reopened = runtime.startThread({ providerId: "codex", threadId: "thr_1" });
    await runtime.closeThread("thr_1");

    await expect(reopened).rejects.toThrow(ThreadClosedError);
    expect(children).toHaveLength(1);
    expect(runtime.hasThread("thr_1")).toBe(false);
  });
});

describe("an idle session", () => {
  it("has its child ended once it has run no turn for the runtime's idle bound", async () => {
    const stderr: [string, string | undefined][] = [];
    const runtime = createAcpAgentRuntime({
      idleSession: { afterMs: 50, everyMs: 20 },
      onEvent: () => {
        /* empty */
      },
      onStderr: (line, threadId) => {
        stderr.push([line, threadId]);
      },
      spawnAdapter: (_harness, env) =>
        spawn(process.execPath, [FAKE_AGENT], {
          detached: true,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        }),
      workspacePath: process.cwd(),
    });
    onTestFinished(async () => {
      await runtime.shutdown();
    });
    await runtime.startThread({ providerId: "codex", threadId: "thr_1" });

    await vi.waitFor(
      () => {
        expect(runtime.hasThread("thr_1")).toBe(false);
      },
      { timeout: 10_000 },
    );
    await vi.waitFor(() => {
      expect(stderr).toContainEqual([
        expect.stringMatching(/^reaped idle agent session for thread thr_1 after \d+ms$/u),
        "thr_1",
      ]);
    });
  });
});
