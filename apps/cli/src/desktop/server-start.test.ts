import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEV_DATA_ROOT_DIR,
  PROD_DATA_DIR_NAME,
  resolveAppConfig,
  VAULT_DIR_ENV_VAR,
  vaultDataDir,
} from "inteligir/server/config";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../server/test-support/boot-app";
import { resolveServerTarget } from "./server-start";

const scratchHome = (): string => makeTempDir("inteligir-shell-home-");

// the mode a packaged shell states
const PACKAGED: NodeJS.ProcessEnv = { NODE_ENV: "production" };

interface ManagedConfig {
  agentModels?: { claude: string };
  cloudUrl?: string;
  port?: number;
  vaultDir?: string;
}

const writeManagedConfig = (dataDir: string, config: ManagedConfig): void => {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "config.json"), JSON.stringify(config), "utf-8");
};

describe("resolveServerTarget", () => {
  it("takes the packaged defaults from the app's own resolution", () => {
    const homeDir = scratchHome();
    const resolved = resolveServerTarget({ env: PACKAGED, homeDir });
    expect(resolved).toEqual({
      kind: "resolved",
      target: {
        dataDir: vaultDataDir(
          path.join(homeDir, PROD_DATA_DIR_NAME),
          path.join(homeDir, "Inteligir"),
        ),
        dataDirSource: "default",
        rootDataDir: path.join(homeDir, PROD_DATA_DIR_NAME),
        vaultDir: path.join(homeDir, "Inteligir"),
        vaultDirSource: "default",
      },
    });
  });

  it("carries config.json's vault dir down to the child", () => {
    const homeDir = scratchHome();
    const vaultDir = path.join(homeDir, "Notes");
    writeManagedConfig(path.join(homeDir, PROD_DATA_DIR_NAME), { vaultDir });
    const resolved = resolveServerTarget({ env: PACKAGED, homeDir });
    expect(resolved.kind === "resolved" && resolved.target.vaultDir).toBe(vaultDir);
    expect(resolved.kind === "resolved" && resolved.target.vaultDirSource).toBe("managed-config");
    expect(resolved.kind === "resolved" && resolved.target.dataDir).toBe(
      vaultDataDir(path.join(homeDir, PROD_DATA_DIR_NAME), vaultDir),
    );
    expect(resolved.kind === "resolved" && resolved.target.rootDataDir).toBe(
      path.join(homeDir, PROD_DATA_DIR_NAME),
    );
  });

  it("leaves a child pinned to its target's vault that target's data dir and the root's config.json", () => {
    const homeDir = scratchHome();
    const cloudUrl = "https://cloud.example.test";
    writeManagedConfig(path.join(homeDir, PROD_DATA_DIR_NAME), {
      agentModels: { claude: "claude-test" },
      cloudUrl,
      port: 4999,
    });
    const resolved = resolveServerTarget({ env: PACKAGED, homeDir });
    if (resolved.kind !== "resolved") {
      throw new Error(resolved.error);
    }
    // a child started with its target's vault pinned, and nothing else
    const env = { ...PACKAGED, [VAULT_DIR_ENV_VAR]: resolved.target.vaultDir };
    const child = resolveServerTarget({ env, homeDir });
    expect(child.kind === "resolved" && child.target.dataDir).toBe(resolved.target.dataDir);
    const served = resolveAppConfig({ checkoutPath: homeDir, env, homeDir });
    expect(served.dataDir).toBe(resolved.target.dataDir);
    expect(served.cloudUrl).toBe(cloudUrl);
    expect(served.port).toBe(4999);
    expect(served.agentModels.claude).toBe("claude-test");
  });

  it("resolves the checkout's own dev instance unless the shell states production", () => {
    const homeDir = scratchHome();
    const resolved = resolveServerTarget({ env: {}, homeDir });
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") {
      return;
    }
    const devRoot = path.join(homeDir, DEV_DATA_ROOT_DIR);
    expect(resolved.target.dataDir.startsWith(devRoot)).toBe(true);
    expect(resolved.target.vaultDir.startsWith(devRoot)).toBe(true);
  });

  it("surfaces the app's own refusal rather than falling back to a default", () => {
    const resolved = resolveServerTarget({
      env: { ...PACKAGED, INTELIGIR_PORT: "65536" },
      homeDir: scratchHome(),
    });
    expect(resolved).toEqual({
      error: "INTELIGIR_PORT must be a valid TCP port",
      kind: "refused",
    });
  });
});
