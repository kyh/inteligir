// driven over a scratch home, never the fixture table: this leaf writes the config.json
// `serve` reads and dials no server.

import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { externalSyncSchema } from "@repo/api/local/vault/vault-schema";
import { DEV_DATA_ROOT_DIR, resolveAppConfig, vaultDataDir } from "../server/config";
import { resolveCheckoutRoot } from "../server/dev-instance";
import { writeServerFile } from "../server/server-file";
import { makeTempDir } from "../server/__tests__/temp-dir";
import { runGit } from "../server/vault/git-run";
import { hermeticGitEnv } from "../server/vault/__tests__/git-test-env";
import { runCliForTest } from "./run-cli";

const envelopeSchema = z.object({ error: z.string().min(1), message: z.string() });
const selectionSchema = z
  .object({
    dataDir: z.string(),
    externalSync: externalSyncSchema.nullable(),
    previousVaultDir: z.string(),
    remote: z.string().nullable(),
    running: z.object({ baseUrl: z.string() }).nullable(),
    vaultDir: z.string(),
  })
  .strict();

// no server: the leaf never dials one, and a dial would be the bug
const NO_SERVER = "http://127.0.0.1:1";

// realpathed: a selection stores the folder's physical spelling, and tmpdir sits under a symlink on macOS
const scratch = () => {
  const homeDir = makeTempDir("inteligir-vault-open-", { realpath: true });
  const config = resolveAppConfig({ checkoutPath: resolveCheckoutRoot(), env: {}, homeDir });
  return { defaultVaultDir: config.vaultDir, homeDir, rootDataDir: config.rootDataDir };
};

const newVault = (homeDir: string, name: string): string => {
  const dir = path.join(homeDir, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const open = async (homeDir: string, dir: string, env: Record<string, string> = {}) =>
  await runCliForTest({
    argv: ["vault", "open", dir, "--json"],
    baseUrl: NO_SERVER,
    env,
    homeDir,
  });

const refused = async (homeDir: string, dir: string, env: Record<string, string> = {}) => {
  const result = await open(homeDir, dir, env);
  expect(result.code).not.toBe(0);
  expect(result.stdout).toBe("");
  return envelopeSchema.parse(JSON.parse(result.stderr));
};

describe("inteligir vault open", () => {
  it("selects the vault the next serve boots on, and names its own data dir", async () => {
    const { homeDir, rootDataDir, defaultVaultDir } = scratch();
    const work = newVault(homeDir, "Work");
    const result = await open(homeDir, work);
    expect(result.code, result.stderr).toBe(0);
    const body = selectionSchema.parse(JSON.parse(result.stdout));
    expect(body).toEqual({
      dataDir: vaultDataDir(rootDataDir, work),
      externalSync: null,
      previousVaultDir: defaultVaultDir,
      remote: null,
      running: null,
      vaultDir: work,
    });
    expect(JSON.parse(readFileSync(path.join(rootDataDir, "config.json"), "utf-8"))).toEqual({
      vaultDir: work,
    });
    const next = resolveAppConfig({ checkoutPath: resolveCheckoutRoot(), env: {}, homeDir });
    expect(next.vaultDir).toBe(work);
    expect(next.dataDir).toBe(body.dataDir);
  });

  it("stores the folder as the disk spells it, so one folder keeps one data dir", async () => {
    const { homeDir, rootDataDir } = scratch();
    const work = newVault(homeDir, "Work");
    const linked = path.join(homeDir, "Linked");
    symlinkSync(work, linked);
    const result = await open(homeDir, linked);
    expect(result.code, result.stderr).toBe(0);
    const body = selectionSchema.parse(JSON.parse(result.stdout));
    expect(body.vaultDir).toBe(work);
    expect(body.dataDir).toBe(vaultDataDir(rootDataDir, work));
    expect(JSON.parse(readFileSync(path.join(rootDataDir, "config.json"), "utf-8"))).toEqual({
      vaultDir: work,
    });
  });

  it("carries every other key of config.json through", async () => {
    const { homeDir, rootDataDir } = scratch();
    mkdirSync(rootDataDir, { recursive: true });
    writeFileSync(
      path.join(rootDataDir, "config.json"),
      JSON.stringify({ later: true, port: 4555 }),
    );
    const work = newVault(homeDir, "Work");
    const opened = await open(homeDir, work);
    expect(opened.code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(rootDataDir, "config.json"), "utf-8"))).toEqual({
      later: true,
      port: 4555,
      vaultDir: work,
    });
  });

  it("leaves a running server alone and says so", async () => {
    const { homeDir, rootDataDir, defaultVaultDir } = scratch();
    mkdirSync(rootDataDir, { recursive: true });
    writeServerFile(rootDataDir, {
      pid: process.pid,
      port: 4664,
      token: "t",
      vaultDir: defaultVaultDir,
      version: "0.1.0-test",
    });
    const work = newVault(homeDir, "Work");
    const result = await open(homeDir, work);
    expect(result.code, result.stderr).toBe(0);
    expect(selectionSchema.parse(JSON.parse(result.stdout)).running).toEqual({
      baseUrl: "http://127.0.0.1:4664",
    });
    // untouched: the row still names the previous vault
    expect(readFileSync(path.join(rootDataDir, "server.json"), "utf-8")).toContain(defaultVaultDir);
  });

  it("names the service that syncs a folder, which the hosted vault then stays off", async () => {
    const { homeDir } = scratch();
    const notes = newVault(
      homeDir,
      path.join("Library", "Mobile Documents", "com~apple~CloudDocs"),
    );
    const json = await open(homeDir, notes);
    expect(json.code, json.stderr).toBe(0);
    expect(selectionSchema.parse(JSON.parse(json.stdout))).toMatchObject({
      externalSync: { kind: "icloud-drive" },
      remote: null,
    });

    const other = newVault(homeDir, path.join("Library", "CloudStorage", "Dropbox", "Notes"));
    const said = await runCliForTest({
      argv: ["vault", "open", other],
      baseUrl: NO_SERVER,
      env: {},
      homeDir,
    });
    expect(said.code, said.stderr).toBe(0);
    expect(`${said.stdout}${said.stderr}`).toContain(
      "Dropbox syncs this folder; inteligir will not sync its notes.",
    );
  });

  it("names a folder's own git remote, redacted", async () => {
    const { homeDir } = scratch();
    const repo = newVault(homeDir, "Repo");
    const env = hermeticGitEnv();
    await runGit(repo, ["init", "-b", "main"], { env });
    await runGit(repo, ["remote", "add", "origin", "https://me:secret@git.example.com/v.git"], {
      env,
    });
    const result = await open(homeDir, repo);
    expect(result.code, result.stderr).toBe(0);
    expect(selectionSchema.parse(JSON.parse(result.stdout))).toMatchObject({
      externalSync: null,
      remote: "https://git.example.com/v.git",
    });
    expect(result.stdout).not.toContain("secret");
  });

  describe("refuses, non-zero and with the JSON envelope, and writes nothing", () => {
    it("a folder inside the root data dir, with the config's own message", async () => {
      const { homeDir, rootDataDir } = scratch();
      const envelope = await refused(homeDir, path.join(rootDataDir, "notes"));
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
      const envelope = await refused(homeDir, path.join(homeDir, "Nowhere"));
      expect(envelope.message).toMatch(/not an existing folder/u);
    });

    it("the vault already selected", async () => {
      const { homeDir, defaultVaultDir } = scratch();
      mkdirSync(defaultVaultDir, { recursive: true });
      const envelope = await refused(homeDir, defaultVaultDir);
      expect(envelope.message).toMatch(/already open/u);
    });

    it("the vault already selected, reached through a symlink", async () => {
      const { homeDir, defaultVaultDir } = scratch();
      mkdirSync(defaultVaultDir, { recursive: true });
      const linked = path.join(homeDir, "Linked");
      symlinkSync(defaultVaultDir, linked);
      const envelope = await refused(homeDir, linked);
      expect(envelope.message).toMatch(/already open/u);
    });

    it("a vault the environment pins", async () => {
      const { homeDir, rootDataDir } = scratch();
      const pinned = newVault(homeDir, "Pinned");
      const work = newVault(homeDir, "Work");
      const envelope = await refused(homeDir, work, { INTELIGIR_VAULT_DIR: pinned });
      expect(envelope.message).toMatch(/INTELIGIR_VAULT_DIR/u);
      expect(() => readFileSync(path.join(rootDataDir, "config.json"))).toThrow();
    });

    it("a data dir the environment pins, which a second vault would share", async () => {
      const { homeDir } = scratch();
      const work = newVault(homeDir, "Work");
      const dataDir = path.join(homeDir, DEV_DATA_ROOT_DIR, "pinned-data");
      mkdirSync(dataDir, { recursive: true });
      const envelope = await refused(homeDir, work, { INTELIGIR_DATA_DIR: dataDir });
      expect(envelope.message).toMatch(/INTELIGIR_DATA_DIR/u);
    });
  });
});
