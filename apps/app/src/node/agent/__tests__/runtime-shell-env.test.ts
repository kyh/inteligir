// The CLI-driving seam: the manager must hand the runtime the shellEnv the
// host resolved (INTELIGIR_SERVER_URL, known only after listen) and the
// session instructions must point the model at the CLI. The runtime's own
// halves are covered elsewhere (buildThreadShellEnvironment adds
// INTELIGIR_THREAD_ID; the codex adapter turns envVars into
// shell_environment_policy config) — what this suite pins is the wiring in
// between, which no type forces because the field is optional.

import type { AgentRuntime } from "@repo/agent-runtime/types";
import type { createAcpAgentRuntime } from "@repo/agent-runtime/acp/acp-runtime";
import { describe, expect, it } from "vitest";
import { delimiter } from "node:path";
import { CLI_POINTER_INSTRUCTIONS } from "../agent-instructions";
import { buildAgentShellEnv } from "../agent-shell-env";
import { createAcpRuntimeManager } from "../runtime-manager";
import { bootTestApp } from "../../__tests__/boot-app";
import { createThread, waitFor } from "./agent-test-harness";

type RuntimeOptions = Parameters<typeof createAcpAgentRuntime>[0];
type StartThreadArgs = Parameters<AgentRuntime["startThread"]>[0];

interface Recorded {
  options: RuntimeOptions[];
  startThreads: StartThreadArgs[];
}

function recordingCreateRuntime(recorded: Recorded): typeof createAcpAgentRuntime {
  return (options) => {
    recorded.options.push(options);
    const runtime: AgentRuntime = {
      ensureProvider: async () => {},
      startThread: async (args) => {
        recorded.startThreads.push(args);
        return { providerThreadId: "prov_1" };
      },
      resumeThread: async () => ({ providerThreadId: "prov_1" }),
      runTurn: async () => {},
      steerTurn: async () => ({ status: "stale", activeTurnId: null }),
      stopThread: async () => {},
      listModels: async () => ({ models: [] }),
      listRunningProviders: () => [],
      getActiveTurnId: () => null,
      waitForActiveTurn: async () => null,
      getProviderSession: () => null,
      reapIdleProviderSessions: async () => ({ reapedSessions: [] }),
      hasThread: () => false,
      getLiveThreadIds: () => [],
      shutdown: async () => {},
    };
    return runtime;
  };
}

describe("codex runtime shell env wiring", () => {
  it("constructs the runtime with the resolved shellEnv and CLI-pointing instructions", async () => {
    const recorded: Recorded = { options: [], startThreads: [] };
    const shellEnv: Record<string, string> = {};
    const harness = await bootTestApp({
      agent: { mode: "codex", runtime: "acp", detail: null },
      makeDriver: ({ db, bus, vault, vaultDir }) => {
        const manager = createAcpRuntimeManager({
          db,
          notifier: bus,
          vaultDir,
          git: vault.git,
          model: null,
          mcpServers: () => [],
          connectedDirs: () => [],
          cliBinDir: "/repo/apps/cli/bin",
          shellEnv: () => ({ ...shellEnv }),
          createRuntime: recordingCreateRuntime(recorded),
          reapIntervalMs: null,
        });
        return { createTurnDriver: manager.createTurnDriver, dispose: () => manager.dispose() };
      },
    });

    // What main.ts does after listen: the getter observes the late binding.
    Object.assign(
      shellEnv,
      buildAgentShellEnv({
        serverUrl: "http://127.0.0.1:21999",
        env: { PATH: "/usr/bin" },
        cliBinDir: "/repo/apps/cli/bin",
      }),
    );

    const threadId = await createThread(harness.client);
    const send = await harness.client.threads.send.$post({
      json: { threadId, text: "drive the CLI", mode: "steer-if-active" },
    });
    expect(send.status).toBe(200);

    const options = await waitFor(() => recorded.options[0], "the runtime to be constructed");
    // The two values this wiring owns — the listen-time server URL and the
    // PREPENDED cli path. Skills resolve from the layout, not from here, so
    // asserting the object whole would make an unrelated resolution failure
    // read as a wiring bug (and did, once they started resolving).
    if (options.shellEnv === undefined) throw new Error("runtime has no shell env");
    expect(options.shellEnv.INTELIGIR_SERVER_URL).toBe("http://127.0.0.1:21999");
    expect(options.shellEnv.PATH).toBe(`/repo/apps/cli/bin${delimiter}/usr/bin`);
    expect(options.workspacePath).toBe(harness.vaultDir);

    const started = await waitFor(() => recorded.startThreads[0], "the session to start");
    // Contains, not equals: the instructions block is a JOIN of the pointers
    // that apply, and the dialect skills add their own when they resolve.
    expect(started.instructions).toContain(CLI_POINTER_INSTRUCTIONS);
    expect(started.instructions).toContain("inteligir guide");
  });
});
