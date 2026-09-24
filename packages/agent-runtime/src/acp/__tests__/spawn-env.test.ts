import { spawn } from "node:child_process";
import { THREAD_ID_ENV_VAR } from "@repo/domain/agent-shell-env";
import { describe, expect, it } from "vitest";
import { createAcpAgentRuntime } from "../acp-runtime";
import type { AcpAgentRuntimeOptions } from "../acp-runtime";
import type { HarnessId, HarnessModels } from "../harness-registry";

// each adapter is a child that exits before the handshake: the env it was handed is the whole
// assertion, so the session it never opens is expected to fail.
const spawnedEnvs = async (
  models: HarnessModels,
): Promise<Map<HarnessId, Record<string, string>>> => {
  const envs = new Map<HarnessId, Record<string, string>>();
  const spawnAdapter: AcpAgentRuntimeOptions["spawnAdapter"] = (harness, env) => {
    envs.set(harness.id, env);
    return {
      child: spawn(process.execPath, ["-e", "process.exit(0)"], {
        stdio: ["pipe", "pipe", "pipe"],
      }),
    };
  };
  const runtime = createAcpAgentRuntime({
    models,
    onEvent: () => {
      /* empty */
    },
    spawnAdapter,
    workspacePath: process.cwd(),
  });
  for (const id of ["claude", "codex"] as const) {
    await expect(runtime.startThread({ providerId: id, threadId: `thr_${id}` })).rejects.toThrow(
      /adapter exited/u,
    );
  }
  await runtime.shutdown();
  return envs;
};

describe("an adapter's spawn env", () => {
  it("carries its own harness's model and never another's", async () => {
    const envs = await spawnedEnvs({ claude: "claude-model-x", codex: "codex-model-y" });
    const claude = envs.get("claude");
    const codex = envs.get("codex");
    expect(claude?.ANTHROPIC_MODEL).toBe("claude-model-x");
    expect(claude?.CODEX_CONFIG ?? "").not.toContain("codex-model-y");
    expect(codex?.CODEX_CONFIG).toBe(JSON.stringify({ model: "codex-model-y" }));
    expect(codex?.ANTHROPIC_MODEL).not.toBe("claude-model-x");
  });

  it("leaves a harness with no model on its vendor's default", async () => {
    const envs = await spawnedEnvs({ claude: "claude-model-x", codex: null });
    expect(envs.get("codex")?.CODEX_CONFIG).toBe(process.env.CODEX_CONFIG);
  });

  it("names the thread it serves", async () => {
    const envs = await spawnedEnvs({ claude: null, codex: null });
    expect(envs.get("claude")?.[THREAD_ID_ENV_VAR]).toBe("thr_claude");
    expect(envs.get("codex")?.[THREAD_ID_ENV_VAR]).toBe("thr_codex");
  });
});
