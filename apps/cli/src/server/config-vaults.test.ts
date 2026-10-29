import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  physicalVaultDir,
  PROD_DATA_DIR_NAME,
  resolveAppConfig,
  VAULTS_DIR_NAME,
  vaultDataDir,
  writeManagedVaultDir,
} from "./config";
import { pathContains } from "./path-containment";
import { resolveVaultCandidate } from "./vault-switch";
import { makeTempDir, TEMP_DIR_FOLDS_CASE } from "./test-support/temp-dir";

const PROD = { NODE_ENV: "production" };

// the scheme spelled out here rather than through vaultDataDir, so a key that drifted from the
// physical path fails rather than agreeing with itself
const keyedBy = (root: string, physical: string): string =>
  path.join(
    root,
    VAULTS_DIR_NAME,
    createHash("sha256").update(physical).digest("hex").slice(0, 16),
  );

const selectAs = (spell: (homeDir: string) => string) => {
  const homeDir = makeTempDir("inteligir-config-test-");
  const root = path.join(homeDir, PROD_DATA_DIR_NAME);
  mkdirSync(path.join(homeDir, "Inteligir"));
  writeManagedVaultDir(root, spell(homeDir));
  const config = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
  return { config, defaultVault: realpathSync.native(path.join(homeDir, "Inteligir")), root };
};

describe("a folder's physical spelling", () => {
  it.each([
    [
      "a folder that is there",
      "/home/me/Notes",
      { "/home/me/Notes": "/home/me/Notes" },
      "/home/me/Notes",
    ],
    ["a missing leaf", "/home/me/New", { "/home/me": "/home/me" }, "/home/me/New"],
    [
      "a missing leaf under a symlinked parent",
      "/home/me/Link/New",
      { "/home/me/Link": "/Volumes/Disk/Real" },
      "/Volumes/Disk/Real/New",
    ],
    [
      "a missing tail under a symlinked ancestor",
      "/home/me/Link/a/b",
      { "/home/me/Link": "/Volumes/Disk/Real" },
      "/Volumes/Disk/Real/a/b",
    ],
    [
      "a folder a case-folding volume answers in its own case",
      "/Users/me/inteligir",
      { "/Users/me/inteligir": "/Users/me/Inteligir" },
      "/Users/me/Inteligir",
    ],
    [
      "a missing leaf on a case-folding volume, under a parent spelled in another case",
      "/USERS/ME/New",
      { "/USERS/ME": "/Users/me" },
      "/Users/me/New",
    ],
    ["a path with nothing of it on disk", "/a/b/../c", {}, "/a/c"],
  ])("%s", (_label, dir, entries, expected) => {
    // a disk of realpaths: every path it names is there and resolves to its value, nothing else is
    const realpaths = new Map(Object.entries(entries));
    expect(physicalVaultDir(dir, (target) => realpaths.get(target) ?? null)).toBe(expected);
  });
});

describe("every vault's data dir", () => {
  it("is the default vault's own beneath the root, as any other vault's is", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const config = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
    const root = path.join(homeDir, PROD_DATA_DIR_NAME);
    expect(config.rootDataDir).toBe(root);
    expect(config.vaultDirSource).toBe("default");
    expect(config.dataDir).toBe(keyedBy(root, physicalVaultDir(path.join(homeDir, "Inteligir"))));
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

  describe("is keyed by the folder's physical path, however the selector spells it", () => {
    it("through a symlink", () => {
      const { config, root } = selectAs((homeDir) => {
        const work = path.join(homeDir, "Work");
        mkdirSync(work);
        const linked = path.join(homeDir, "Linked");
        symlinkSync(work, linked);
        return linked;
      });
      expect(config.dataDir).toBe(
        keyedBy(root, realpathSync.native(path.join(path.dirname(root), "Work"))),
      );
    });

    it("the default through a symlink, which keeps the default's dir", () => {
      const { config, defaultVault, root } = selectAs((homeDir) => {
        const linked = path.join(homeDir, "Linked");
        symlinkSync(path.join(homeDir, "Inteligir"), linked);
        return linked;
      });
      expect(config.dataDir).toBe(keyedBy(root, defaultVault));
    });

    it.skipIf(!TEMP_DIR_FOLDS_CASE)("in another case, where the volume folds case", () => {
      const { config, defaultVault, root } = selectAs((homeDir) => path.join(homeDir, "inteligir"));
      expect(config.dataDir).toBe(keyedBy(root, defaultVault));
    });
  });

  it("stays put from a vault's first boot, before its folder exists, to its second", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const root = path.join(homeDir, PROD_DATA_DIR_NAME);
    const real = path.join(homeDir, "Real");
    mkdirSync(real);
    symlinkSync(real, path.join(homeDir, "Linked"));
    const vaultDir = path.join(homeDir, "Linked", "Notes");
    writeManagedVaultDir(root, vaultDir);
    const first = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
    mkdirSync(vaultDir);
    const second = resolveAppConfig({ checkoutPath: "/checkout/a", env: PROD, homeDir });
    expect(second.dataDir).toBe(first.dataDir);
    expect(first.dataDir).toBe(keyedBy(root, path.join(realpathSync.native(real), "Notes")));
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

describe("a vault chosen for the selector", () => {
  it("is stored by its physical spelling", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const work = path.join(homeDir, "Work");
    mkdirSync(work);
    const linked = path.join(homeDir, "Linked");
    symlinkSync(work, linked);
    const args = { checkoutPath: "/checkout/a", env: PROD, homeDir };
    const candidate = resolveVaultCandidate(args, linked);
    expect(candidate.vaultDir).toBe(realpathSync.native(work));
    expect(candidate.dataDir).toBe(resolveVaultCandidate(args, work).dataDir);
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
    expect(config.dataDir).toBe(vaultDataDir(root, path.join(homeDir, "Inteligir")));
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
