import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { THREAD_ID_ENV_VAR } from "@repo/domain/agent-shell-env";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createAcpAgentRuntime } from "../acp-runtime";
import type { AcpAgentRuntimeOptions } from "../acp-runtime";
import { HARNESS_IDS } from "../harness-registry";
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

  it("hands codex its native binary, so no node interpreter has to launch it", async () => {
    const hostCodexPath = process.env.CODEX_PATH;
    delete process.env.CODEX_PATH;
    onTestFinished(() => {
      if (hostCodexPath !== undefined) {
        process.env.CODEX_PATH = hostCodexPath;
      }
    });
    const envs = await spawnedEnvs({ claude: null, codex: null });
    const codexPath = envs.get("codex")?.CODEX_PATH ?? "";
    expect(path.basename(codexPath)).toMatch(/^codex(?:\.exe)?$/u);
    expect(existsSync(codexPath)).toBe(true);
    expect(envs.get("claude")?.CODEX_PATH).toBeUndefined();
  });

  // the vendor's own config under these dirs is the only MCP config a session loads, so an adapter
  // pointed anywhere else would read servers the user never added.
  it("hands every adapter the host's vendor config dirs unchanged", async () => {
    const dirs = {
      CLAUDE_CONFIG_DIR: "/Users/someone/.config/claude",
      CODEX_HOME: "/Users/someone/.config/codex",
      HOME: "/Users/someone",
    };
    for (const [name, value] of Object.entries(dirs)) {
      vi.stubEnv(name, value);
    }
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const envs = await spawnedEnvs({ claude: "claude-model-x", codex: "codex-model-y" });
    for (const id of HARNESS_IDS) {
      expect(envs.get(id)).toMatchObject(dirs);
    }
  });

  it("names no vendor config dir the host did not", async () => {
    for (const name of ["CLAUDE_CONFIG_DIR", "CODEX_HOME"]) {
      // oxlint-disable-next-line unicorn/no-useless-undefined -- stubEnv unsets a variable only when handed undefined
      vi.stubEnv(name, undefined);
    }
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const envs = await spawnedEnvs({ claude: null, codex: null });
    for (const id of HARNESS_IDS) {
      expect(envs.get(id)).not.toHaveProperty("CLAUDE_CONFIG_DIR");
      expect(envs.get(id)).not.toHaveProperty("CODEX_HOME");
      expect(envs.get(id)?.HOME).toBe(process.env.HOME);
    }
  });

  it("keeps a codex the host already named", async () => {
    vi.stubEnv("CODEX_PATH", "/opt/codex/bin/codex");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const envs = await spawnedEnvs({ claude: null, codex: null });
    expect(envs.get("codex")?.CODEX_PATH).toBe("/opt/codex/bin/codex");
  });
});
