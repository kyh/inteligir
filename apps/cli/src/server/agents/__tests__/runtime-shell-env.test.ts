import type { AgentRuntime } from "@repo/agent-runtime/types";
import type { createAcpAgentRuntime } from "@repo/agent-runtime/acp/acp-runtime";
import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { createAcpRuntimeManager } from "../runtime-manager";
import { bootTestApp } from "../../__tests__/boot-app";
import { createThread, fakeSessionFacts, PROVIDER_WAIT } from "./agent-test-harness";

type RuntimeOptions = Parameters<typeof createAcpAgentRuntime>[0];

const recordingCreateRuntime =
  (recorded: RuntimeOptions[]): typeof createAcpAgentRuntime =>
  (options) => {
    recorded.push(options);
    const runtime: AgentRuntime = {
      hasThread: () => false,
      reapIdleProviderSessions: async () => await Promise.resolve({ reapedSessions: [] }),
      resumeThread: async () => await Promise.resolve({ providerThreadId: "prov_1" }),
      runTurn: async () => {
        await Promise.resolve();
      },
      shutdown: async () => {
        await Promise.resolve();
      },
      startThread: async () => await Promise.resolve({ providerThreadId: "prov_1" }),
    };
    return runtime;
  };

describe("ACP runtime shell env wiring", () => {
  it("constructs the runtime with a shellEnv projected from the session facts", async () => {
    const recorded: RuntimeOptions[] = [];
    const harness = await bootTestApp({
      agent: { detail: null, mode: "auto", runtime: "acp" },
      makeDriver: ({ db, bus, vault, vaultDir }) => {
        const manager = createAcpRuntimeManager({
          createRuntime: recordingCreateRuntime(recorded),
          db,
          defaultProviderId: () => "claude",
          git: vault.git,
          hostEnv: { PATH: "/usr/bin" },
          mcpServers: () => [],
          model: null,
          notifier: bus,
          reapIntervalMs: null,
          sessionFacts: () =>
            fakeSessionFacts({ cliBinDir: "/repo/apps/cli/bin", dataDir: "/instances/one/data" }),
          vaultDir,
        });
        return {
          createTurnDriver: manager.createTurnDriver,
          dispose: async () => {
            await manager.dispose();
          },
        };
      },
    });

    const threadId = await createThread(harness.client);
    const send = await harness.client.threads.send({
      text: "drive the CLI",
      threadId,
    });
    expect(send.kind).toBe("started");

    const options = await vi.waitFor(() => {
      const [first] = recorded;
      if (first === undefined) {
        throw new Error("the runtime has not been constructed yet");
      }
      return first;
    }, PROVIDER_WAIT);
    // a getter, never a value: the runtime reads it at every adapter spawn.
    if (options.shellEnv === undefined) {
      throw new Error("runtime has no shell env");
    }
    const shellEnv = options.shellEnv();
    expect(shellEnv.INTELIGIR_DATA_DIR).toBe("/instances/one/data");
    expect(shellEnv.PATH).toBe(`/repo/apps/cli/bin${path.delimiter}/usr/bin`);
    expect(options.workspacePath).toBe(harness.vaultDir);
  });
});
