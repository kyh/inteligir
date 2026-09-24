import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { createAcpAgentRuntime, ThreadClosedError } from "../acp-runtime";
import type { AcpAgentRuntimeOptions } from "../acp-runtime";

const FAKE_AGENT = fileURLToPath(new URL("../../test-support/fake-acp-agent.mjs", import.meta.url));

describe("closing a thread", () => {
  it("while an open awaits the previous child's close, leaves no child spawned", async () => {
    const children: ChildProcess[] = [];
    const spawnAdapter: AcpAgentRuntimeOptions["spawnAdapter"] = (_harness, env) => {
      const child = spawn(process.execPath, [FAKE_AGENT], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      children.push(child);
      return { child };
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
