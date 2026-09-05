import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROD_DATA_DIR_NAME,
  resolveAppConfig,
  VAULTS_DIR_NAME,
  vaultDataDir,
  writeManagedVaultDir,
} from "../config";
import { pathContains } from "../path-containment";
import { makeTempDir } from "./temp-dir";

const PROD = { NODE_ENV: "production" };

describe("a second vault's data dir", () => {
  it("keeps the root for the default vault, as before", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const config = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
    expect(config.rootDataDir).toBe(join(homeDir, PROD_DATA_DIR_NAME));
    expect(config.dataDir).toBe(config.rootDataDir);
    expect(config.vaultDirSource).toBe("default");
  });

  it("gives any other vault a dir of its own beneath the root, keyed by its path", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const root = join(homeDir, PROD_DATA_DIR_NAME);
    const vaultDir = join(homeDir, "Work");
    writeManagedVaultDir(root, vaultDir);
    const config = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
    expect(config.vaultDir).toBe(vaultDir);
    expect(config.vaultDirSource).toBe("managed-config");
    expect(config.rootDataDir).toBe(root);
    expect(config.dataDir).toBe(vaultDataDir(root, vaultDir));
    expect(pathContains(join(root, VAULTS_DIR_NAME), config.dataDir)).toBe(true);
    expect(config.databasePath).toBe(join(config.dataDir, "inteligir.db"));
  });

  it("lands the same vault in the same dir whether the env or config.json names it", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const root = join(homeDir, PROD_DATA_DIR_NAME);
    const vaultDir = join(homeDir, "Work");
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
      env: { INTELIGIR_DATA_DIR: dataDir, INTELIGIR_VAULT_DIR: join(homeDir, "Elsewhere") },
      homeDir,
    });
    expect(config.dataDir).toBe(dataDir);
    expect(config.rootDataDir).toBe(dataDir);
  });

  it("refuses a vault inside the root, which holds every vault's data", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const root = join(homeDir, PROD_DATA_DIR_NAME);
    writeManagedVaultDir(root, join(root, "notes"));
    expect(() => resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir })).toThrow(
      /must be disjoint/,
    );
  });
});

describe("rewriting the vault selector", () => {
  it("sets vaultDir and carries every other key through", () => {
    const root = makeTempDir("inteligir-config-test-");
    writeFileSync(
      join(root, "config.json"),
      JSON.stringify({ port: 4555, futureKey: { on: true } }),
    );
    writeManagedVaultDir(root, "/vaults/one");
    writeManagedVaultDir(root, "/vaults/two");
    expect(JSON.parse(readFileSync(join(root, "config.json"), "utf8"))).toEqual({
      port: 4555,
      futureKey: { on: true },
      vaultDir: "/vaults/two",
    });
  });

  it("creates the file when there is none and refuses to clobber bytes it cannot read", () => {
    const root = join(makeTempDir("inteligir-config-test-"), "fresh");
    writeManagedVaultDir(root, "/vaults/one");
    expect(JSON.parse(readFileSync(join(root, "config.json"), "utf8"))).toEqual({
      vaultDir: "/vaults/one",
    });
    writeFileSync(join(root, "config.json"), "{not json");
    expect(() => writeManagedVaultDir(root, "/vaults/two")).toThrow(/not valid JSON/);
  });
});
