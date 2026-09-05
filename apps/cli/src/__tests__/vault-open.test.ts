// driven over a scratch home, never the fixture table: this leaf writes the config.json
// `serve` reads and dials no server.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEV_DATA_ROOT_DIR, resolveAppConfig, vaultDataDir } from "../server/config";
import { resolveCheckoutRoot } from "../server/dev-instance";
import { writeServerFile } from "../server/server-file";
import { makeTempDir } from "../server/__tests__/temp-dir";
import { runCliForTest } from "./run-cli";

const envelopeSchema = z.object({ error: z.string().min(1), message: z.string() });
const selectionSchema = z
  .object({
    vaultDir: z.string(),
    dataDir: z.string(),
    previousVaultDir: z.string(),
    running: z.object({ baseUrl: z.string() }).nullable(),
  })
  .strict();

// no server: the leaf never dials one, and a dial would be the bug
const NO_SERVER = "http://127.0.0.1:1";

function scratch() {
  const homeDir = makeTempDir("inteligir-vault-open-");
  const config = resolveAppConfig({ checkoutPath: resolveCheckoutRoot(), env: {}, homeDir });
  return { homeDir, rootDataDir: config.rootDataDir, defaultVaultDir: config.vaultDir };
}

function newVault(homeDir: string, name: string): string {
  const dir = join(homeDir, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function open(homeDir: string, dir: string, env: Record<string, string> = {}) {
  return runCliForTest({
    argv: ["vault", "open", dir, "--json"],
    baseUrl: NO_SERVER,
    homeDir,
    env,
  });
}

describe("inteligir vault open", () => {
  it("selects the vault the next serve boots on, and names its own data dir", async () => {
    const { homeDir, rootDataDir, defaultVaultDir } = scratch();
    const work = newVault(homeDir, "Work");
    const result = await open(homeDir, work);
    expect(result.code, result.stderr).toBe(0);
    const body = selectionSchema.parse(JSON.parse(result.stdout));
    expect(body).toEqual({
      vaultDir: work,
      dataDir: vaultDataDir(rootDataDir, work),
      previousVaultDir: defaultVaultDir,
      running: null,
    });
    expect(JSON.parse(readFileSync(join(rootDataDir, "config.json"), "utf8"))).toEqual({
      vaultDir: work,
    });
    const next = resolveAppConfig({ checkoutPath: resolveCheckoutRoot(), env: {}, homeDir });
    expect(next.vaultDir).toBe(work);
    expect(next.dataDir).toBe(body.dataDir);
  });

  it("carries every other key of config.json through", async () => {
    const { homeDir, rootDataDir } = scratch();
    mkdirSync(rootDataDir, { recursive: true });
    writeFileSync(join(rootDataDir, "config.json"), JSON.stringify({ port: 4555, later: true }));
    const work = newVault(homeDir, "Work");
    expect((await open(homeDir, work)).code).toBe(0);
    expect(JSON.parse(readFileSync(join(rootDataDir, "config.json"), "utf8"))).toEqual({
      port: 4555,
      later: true,
      vaultDir: work,
    });
  });

  it("leaves a running server alone and says so", async () => {
    const { homeDir, rootDataDir, defaultVaultDir } = scratch();
    mkdirSync(rootDataDir, { recursive: true });
    writeServerFile(rootDataDir, {
      port: 4664,
      token: "t",
      vaultDir: defaultVaultDir,
      pid: process.pid,
    });
    const work = newVault(homeDir, "Work");
    const result = await open(homeDir, work);
    expect(result.code, result.stderr).toBe(0);
    expect(selectionSchema.parse(JSON.parse(result.stdout)).running).toEqual({
      baseUrl: "http://127.0.0.1:4664",
    });
    // untouched: the row still names the previous vault
    expect(readFileSync(join(rootDataDir, "server.json"), "utf8")).toContain(defaultVaultDir);
  });

  describe("refuses, non-zero and with the JSON envelope, and writes nothing", () => {
    async function refused(homeDir: string, dir: string, env: Record<string, string> = {}) {
      const result = await open(homeDir, dir, env);
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      return envelopeSchema.parse(JSON.parse(result.stderr));
    }

    it("a folder inside the root data dir, with the config's own message", async () => {
      const { homeDir, rootDataDir } = scratch();
      const envelope = await refused(homeDir, join(rootDataDir, "notes"));
      expect(envelope.error).toBe("INVALID_USAGE");
      expect(envelope.message).toMatch(/must be disjoint/u);
    });

    it("a relative path", async () => {
      const { homeDir } = scratch();
      const envelope = await refused(homeDir, "Work");
      expect(envelope.message).toMatch(/absolute path/u);
    });

    it("a folder that does not exist", async () => {
      const { homeDir } = scratch();
      const envelope = await refused(homeDir, join(homeDir, "Nowhere"));
      expect(envelope.message).toMatch(/not a directory/u);
    });

    it("the vault already selected", async () => {
      const { homeDir, defaultVaultDir } = scratch();
      mkdirSync(defaultVaultDir, { recursive: true });
      const envelope = await refused(homeDir, defaultVaultDir);
      expect(envelope.message).toMatch(/already open/u);
    });

    it("a vault the environment pins", async () => {
      const { homeDir, rootDataDir } = scratch();
      const pinned = newVault(homeDir, "Pinned");
      const work = newVault(homeDir, "Work");
      const envelope = await refused(homeDir, work, { INTELIGIR_VAULT_DIR: pinned });
      expect(envelope.message).toMatch(/INTELIGIR_VAULT_DIR/u);
      expect(() => readFileSync(join(rootDataDir, "config.json"))).toThrow();
    });

    it("a data dir the environment pins, which a second vault would share", async () => {
      const { homeDir } = scratch();
      const work = newVault(homeDir, "Work");
      const dataDir = join(homeDir, DEV_DATA_ROOT_DIR, "pinned-data");
      mkdirSync(dataDir, { recursive: true });
      const envelope = await refused(homeDir, work, { INTELIGIR_DATA_DIR: dataDir });
      expect(envelope.message).toMatch(/INTELIGIR_DATA_DIR/u);
    });
  });
});
