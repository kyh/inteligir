import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROD_DATA_DIR_NAME,
  resolveAppConfig,
  VAULTS_DIR_NAME,
  vaultDataDir,
  writeManagedVaultDir,
} from "../config";
import { pathContains } from "../path-containment";
import { resolveVaultCandidate } from "../vault-switch";
import { makeTempDir, TEMP_DIR_FOLDS_CASE } from "./temp-dir";

const PROD = { NODE_ENV: "production" };

const selectDefaultAs = (spell: (homeDir: string) => string) => {
  const homeDir = makeTempDir("inteligir-config-test-");
  const root = path.join(homeDir, PROD_DATA_DIR_NAME);
  mkdirSync(path.join(homeDir, "Inteligir"));
  writeManagedVaultDir(root, spell(homeDir));
  return { config: resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir }), root };
};

describe("a second vault's data dir", () => {
  it("keeps the root for the default vault, as before", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const config = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
    expect(config.rootDataDir).toBe(path.join(homeDir, PROD_DATA_DIR_NAME));
    expect(config.dataDir).toBe(config.rootDataDir);
    expect(config.vaultDirSource).toBe("default");
  });

  it("gives any other vault a dir of its own beneath the root, keyed by its path", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const root = path.join(homeDir, PROD_DATA_DIR_NAME);
    const vaultDir = path.join(homeDir, "Work");
    writeManagedVaultDir(root, vaultDir);
    const config = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
    expect(config.vaultDir).toBe(vaultDir);
    expect(config.vaultDirSource).toBe("managed-config");
    expect(config.rootDataDir).toBe(root);
    expect(config.dataDir).toBe(vaultDataDir(root, vaultDir));
    expect(pathContains(path.join(root, VAULTS_DIR_NAME), config.dataDir)).toBe(true);
    expect(config.databasePath).toBe(path.join(config.dataDir, "inteligir.db"));
  });

  it("lands the same vault in the same dir whether the env or config.json names it", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const root = path.join(homeDir, PROD_DATA_DIR_NAME);
    const vaultDir = path.join(homeDir, "Work");
    writeManagedVaultDir(root, vaultDir);
    const managed = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
    const viaEnv = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { ...PROD, INTELIGIR_VAULT_DIR: vaultDir },
      homeDir,
    });
    expect(viaEnv.dataDir).toBe(managed.dataDir);
    expect(viaEnv.vaultDirSource).toBe("env");
  });

  it("takes an explicit data dir as given, whatever the vault", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    const config = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir, INTELIGIR_VAULT_DIR: path.join(homeDir, "Elsewhere") },
      homeDir,
    });
    expect(config.dataDir).toBe(dataDir);
    expect(config.rootDataDir).toBe(dataDir);
  });

  describe("keeps the root for the default vault however the selector spells it", () => {
    it("through a symlink", () => {
      const { config, root } = selectDefaultAs((homeDir) => {
        const linked = path.join(homeDir, "Linked");
        symlinkSync(path.join(homeDir, "Inteligir"), linked);
        return linked;
      });
      expect(config.dataDir).toBe(root);
    });

    it.skipIf(!TEMP_DIR_FOLDS_CASE)("in another case, where the volume folds case", () => {
      const { config, root } = selectDefaultAs((homeDir) => path.join(homeDir, "inteligir"));
      expect(config.dataDir).toBe(root);
    });
  });

  it("keys any other vault by the spelling the selector stores, never re-derived", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const root = path.join(homeDir, PROD_DATA_DIR_NAME);
    const work = path.join(homeDir, "Work");
    mkdirSync(work);
    const linked = path.join(homeDir, "Linked");
    symlinkSync(work, linked);
    writeManagedVaultDir(root, linked);
    const config = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
    expect(config.dataDir).toBe(vaultDataDir(root, linked));
    expect(config.dataDir).not.toBe(vaultDataDir(root, realpathSync.native(work)));
  });

  it("refuses a vault inside the root, which holds every vault's data", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const root = path.join(homeDir, PROD_DATA_DIR_NAME);
    writeManagedVaultDir(root, path.join(root, "notes"));
    expect(() => resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir })).toThrow(
      /must be disjoint/u,
    );
  });
});

const linkedWork = () => {
  const homeDir = makeTempDir("inteligir-config-test-");
  const work = path.join(homeDir, "Work");
  mkdirSync(work);
  const linked = path.join(homeDir, "Linked");
  symlinkSync(work, linked);
  return {
    args: { checkoutPath: "/checkout/a", env: PROD, homeDir },
    linked,
    root: path.join(homeDir, PROD_DATA_DIR_NAME),
    work: realpathSync.native(work),
  };
};

describe("a vault chosen for the selector", () => {
  it("is stored by its physical spelling, so one folder keeps one data dir", () => {
    const { args, linked, root, work } = linkedWork();
    const candidate = resolveVaultCandidate(args, linked);
    expect(candidate.vaultDir).toBe(work);
    expect(candidate.dataDir).toBe(vaultDataDir(root, work));
  });

  it("keeps the spelling given when only that spelling already keys a data dir", () => {
    const { args, linked, root } = linkedWork();
    mkdirSync(vaultDataDir(root, linked), { recursive: true });
    const candidate = resolveVaultCandidate(args, linked);
    expect(candidate.vaultDir).toBe(linked);
    expect(candidate.dataDir).toBe(vaultDataDir(root, linked));
  });

  it("takes the physical spelling once its own data dir exists", () => {
    const { args, linked, root, work } = linkedWork();
    mkdirSync(vaultDataDir(root, linked), { recursive: true });
    mkdirSync(vaultDataDir(root, work), { recursive: true });
    expect(resolveVaultCandidate(args, linked).dataDir).toBe(vaultDataDir(root, work));
  });
});

describe("rewriting the vault selector", () => {
  it("sets vaultDir and carries every other key through", () => {
    const root = makeTempDir("inteligir-config-test-");
    writeFileSync(
      path.join(root, "config.json"),
      JSON.stringify({ futureKey: { on: true }, port: 4555 }),
    );
    writeManagedVaultDir(root, "/vaults/one");
    writeManagedVaultDir(root, "/vaults/two");
    expect(JSON.parse(readFileSync(path.join(root, "config.json"), "utf-8"))).toEqual({
      futureKey: { on: true },
      port: 4555,
      vaultDir: "/vaults/two",
    });
  });

  it("clears vaultDir back to the default vault and keeps every other key", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const root = path.join(homeDir, PROD_DATA_DIR_NAME);
    mkdirSync(root);
    writeFileSync(
      path.join(root, "config.json"),
      JSON.stringify({ futureKey: { on: true }, port: 4555, vaultDir: "/vaults/one" }),
    );
    writeManagedVaultDir(root, null);
    expect(JSON.parse(readFileSync(path.join(root, "config.json"), "utf-8"))).toEqual({
      futureKey: { on: true },
      port: 4555,
    });
    const config = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
    expect(config.vaultDirSource).toBe("default");
    expect(config.dataDir).toBe(root);
  });

  it("creates the file when there is none and refuses to clobber bytes it cannot read", () => {
    const root = path.join(makeTempDir("inteligir-config-test-"), "fresh");
    writeManagedVaultDir(root, "/vaults/one");
    expect(JSON.parse(readFileSync(path.join(root, "config.json"), "utf-8"))).toEqual({
      vaultDir: "/vaults/one",
    });
    writeFileSync(path.join(root, "config.json"), "{not json");
    expect(() => {
      writeManagedVaultDir(root, "/vaults/two");
    }).toThrow(/not valid JSON/u);
  });
});
