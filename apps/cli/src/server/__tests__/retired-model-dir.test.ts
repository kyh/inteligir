import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROD_DATA_DIR_NAME, resolveAppConfig } from "../config";
import { removeRetiredModelDir } from "../retired-model-dir";
import { makeTempDir } from "./temp-dir";

const CHECKOUT = "/checkout/a";

// the shape an interrupted download left: a partial archive and nothing else
const seedModelDir = (root: string): string => {
  const modelDir = path.join(root, "models");
  mkdirSync(modelDir, { recursive: true });
  const partial = path.join(modelDir, "x.partial-abc");
  writeFileSync(partial, "partial model bytes");
  return partial;
};

describe("the retired model folder", () => {
  it("is removed from an installed app's own data root, and nothing beside it is", async () => {
    const homeDir = makeTempDir("inteligir-models-test-");
    const root = path.join(homeDir, PROD_DATA_DIR_NAME);
    seedModelDir(root);
    const beside = path.join(root, "inteligir.db");
    writeFileSync(beside, "");
    const config = resolveAppConfig({
      checkoutPath: CHECKOUT,
      env: { NODE_ENV: "production" },
      homeDir,
    });

    await removeRetiredModelDir(config);

    expect(existsSync(path.join(root, "models"))).toBe(false);
    expect(existsSync(beside)).toBe(true);
  });

  it.each([
    ["the default vault's", PROD_DATA_DIR_NAME],
    ["another vault's", path.join(PROD_DATA_DIR_NAME, "vaults", "0123456789abcdef")],
  ])("is removed when the desktop pins %s data dir inside the root", async (_, pinned) => {
    const homeDir = makeTempDir("inteligir-models-test-");
    const root = path.join(homeDir, PROD_DATA_DIR_NAME);
    seedModelDir(root);
    // the server's own db is in it by the time the folder is removed
    const dataDir = path.join(homeDir, pinned);
    mkdirSync(dataDir, { recursive: true });
    const config = resolveAppConfig({
      checkoutPath: CHECKOUT,
      env: { INTELIGIR_DATA_DIR: dataDir, NODE_ENV: "production" },
      homeDir,
    });

    await removeRetiredModelDir(config);

    expect(existsSync(path.join(root, "models"))).toBe(false);
  });

  it("answers a root that holds no model folder", async () => {
    const homeDir = makeTempDir("inteligir-models-test-");
    const config = resolveAppConfig({
      checkoutPath: CHECKOUT,
      env: { NODE_ENV: "production" },
      homeDir,
    });

    await expect(removeRetiredModelDir(config)).resolves.toBeUndefined();
  });

  it.each([
    ["a dev instance", {}],
    [
      "a data dir pinned outside the root",
      { INTELIGIR_DATA_DIR: "~/elsewhere", NODE_ENV: "production" },
    ],
  ])("is left alone by %s, which does not own the installed app's root", async (_, env) => {
    const homeDir = makeTempDir("inteligir-models-test-");
    const config = resolveAppConfig({ checkoutPath: CHECKOUT, env, homeDir });
    const seeded = [
      seedModelDir(path.join(homeDir, PROD_DATA_DIR_NAME)),
      seedModelDir(config.rootDataDir),
    ];

    await removeRetiredModelDir(config);

    for (const partial of seeded) {
      expect(existsSync(partial), partial).toBe(true);
    }
  });

  it("is left alone when a symlinked vault physically lives inside it", async () => {
    const homeDir = makeTempDir("inteligir-models-test-");
    const partial = seedModelDir(path.join(homeDir, PROD_DATA_DIR_NAME));
    const physicalVault = path.join(path.dirname(partial), "vault");
    mkdirSync(physicalVault);
    const note = path.join(physicalVault, "Note.md");
    writeFileSync(note, "# Note\n");
    const vaultLink = path.join(homeDir, "Notes");
    symlinkSync(physicalVault, vaultLink);
    const config = resolveAppConfig({
      checkoutPath: CHECKOUT,
      env: { INTELIGIR_VAULT_DIR: vaultLink, NODE_ENV: "production" },
      homeDir,
    });

    await removeRetiredModelDir(config);

    expect(existsSync(note)).toBe(true);
  });
});
