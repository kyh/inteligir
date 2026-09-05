import type { AgentRuntime } from "@repo/agent-runtime/types";
import type { createAcpAgentRuntime } from "@repo/agent-runtime/acp/acp-runtime";
import { describe, expect, it, vi } from "vitest";
import { delimiter } from "node:path";
import { createAcpRuntimeManager } from "../runtime-manager";
import { bootTestApp } from "../../__tests__/boot-app";
import { createThread, fakeSessionFacts, PROVIDER_WAIT } from "./agent-test-harness";

type RuntimeOptions = Parameters<typeof createAcpAgentRuntime>[0];

function recordingCreateRuntime(recorded: RuntimeOptions[]): typeof createAcpAgentRuntime {
  return (options) => {
    recorded.push(options);
    const runtime: AgentRuntime = {
      startThread: async () => ({ providerThreadId: "prov_1" }),
      resumeThread: async () => ({ providerThreadId: "prov_1" }),
      runTurn: async () => {},
      reapIdleProviderSessions: async () => ({ reapedSessions: [] }),
      hasThread: () => false,
      shutdown: async () => {},
    };
    return runtime;
  };
}

describe("ACP runtime shell env wiring", () => {
  it("constructs the runtime with a shellEnv projected from the session facts", async () => {
    const recorded: RuntimeOptions[] = [];
    const harness = await bootTestApp({
      agent: { mode: "auto", runtime: "acp", detail: null },
      makeDriver: ({ db, bus, vault, vaultDir }) => {
        const manager = createAcpRuntimeManager({
          db,
          notifier: bus,
          vaultDir,
          git: vault.git,
          model: null,
          mcpServers: () => [],
          sessionFacts: () =>
            fakeSessionFacts({ dataDir: "/instances/one/data", cliBinDir: "/repo/apps/cli/bin" }),
          hostEnv: { PATH: "/usr/bin" },
          defaultProviderId: () => "claude",
          createRuntime: recordingCreateRuntime(recorded),
          reapIntervalMs: null,
        });
        return { createTurnDriver: manager.createTurnDriver, dispose: () => manager.dispose() };
      },
    });

    const threadId = await createThread(harness.client);
    const send = await harness.client.threads.send({
      threadId,
      text: "drive the CLI",
    });
    expect(send.kind).toBe("started");

    const options = await vi.waitFor(() => {
      const [first] = recorded;
      if (first === undefined) throw new Error("the runtime has not been constructed yet");
      return first;
    }, PROVIDER_WAIT);
    // a getter, never a value: the runtime reads it at every adapter spawn.
    if (options.shellEnv === undefined) throw new Error("runtime has no shell env");
    const shellEnv = options.shellEnv();
    expect(shellEnv.INTELIGIR_DATA_DIR).toBe("/instances/one/data");
    expect(shellEnv.PATH).toBe(`/repo/apps/cli/bin${delimiter}/usr/bin`);
    expect(options.workspacePath).toBe(harness.vaultDir);
  });
});
