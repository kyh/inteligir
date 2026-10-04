import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { makeTempDir, TEMP_DIR_FOLDS_CASE } from "inteligir/server/testing";
import { describe, expect, it } from "vitest";
import type { ServerTarget } from "../server-start";
import { planVaultSwitch, switchRefusalMessage } from "../vaults";
import type { VaultSwitchRefusal } from "../vaults";

const target = (overrides: Partial<ServerTarget> = {}): ServerTarget => ({
  dataDir: "/home/me/.inteligir",
  dataDirSource: "default",
  rootDataDir: "/home/me/.inteligir",
  vaultDir: "/home/me/Inteligir",
  vaultDirSource: "default",
  ...overrides,
});

const openVault = (): string => {
  const vaultDir = path.join(makeTempDir("inteligir-vault-"), "Notes");
  mkdirSync(vaultDir);
  return vaultDir;
};

// the app's data under a home of its own, not made yet, as on a first launch
const scratchHome = () => {
  const home = makeTempDir("inteligir-home-");
  return { current: target({ rootDataDir: path.join(home, ".inteligir") }), home };
};

describe("what may be switched", () => {
  it("switches to another folder that exists", () => {
    const folder = makeTempDir("inteligir-vault-");
    expect(planVaultSwitch(target(), folder)).toEqual({ kind: "switch" });
  });

  it("refuses a folder that is gone before anything is stopped", () => {
    expect(planVaultSwitch(target(), "/home/me/Gone")).toEqual({
      kind: "refused",
      reason: "not-a-directory",
    });
  });

  it("refuses while the env pins the vault or the data dir", () => {
    const folder = makeTempDir("inteligir-vault-");
    expect(planVaultSwitch(target({ vaultDirSource: "env" }), folder)).toEqual({
      kind: "refused",
      reason: "vault-pinned-by-env",
    });
    expect(planVaultSwitch(target({ dataDirSource: "env" }), folder)).toEqual({
      kind: "refused",
      reason: "data-dir-pinned-by-env",
    });
  });

  it("refuses the vault already open, however it is spelled", () => {
    expect(planVaultSwitch(target(), "/home/me/Inteligir/")).toEqual({
      kind: "refused",
      reason: "already-open",
    });
  });

  describe("refuses the vault already open when the picker names the same folder", () => {
    it("through a symlink", () => {
      const vaultDir = openVault();
      const linked = path.join(path.dirname(vaultDir), "Linked");
      symlinkSync(vaultDir, linked);
      expect(planVaultSwitch(target({ vaultDir }), linked)).toEqual({
        kind: "refused",
        reason: "already-open",
      });
    });

    it.skipIf(!TEMP_DIR_FOLDS_CASE)("in another case, where the volume folds case", () => {
      const vaultDir = openVault();
      const respelled = path.join(path.dirname(vaultDir), "notes");
      expect(planVaultSwitch(target({ vaultDir }), respelled)).toEqual({
        kind: "refused",
        reason: "already-open",
      });
    });
  });

  describe("refuses a folder that nests with the app's own data before anything is stopped", () => {
    it("one holding it", () => {
      const { current, home } = scratchHome();
      expect(planVaultSwitch(current, home)).toEqual({
        kind: "refused",
        reason: "holds-app-data",
      });
    });

    it.each([
      ["one inside it", "Notes"],
      ["the data folder itself", ""],
    ])("%s", (_label, below) => {
      const { current } = scratchHome();
      const inside = path.join(current.rootDataDir, below);
      mkdirSync(inside, { recursive: true });
      expect(planVaultSwitch(current, inside)).toEqual({
        kind: "refused",
        reason: "inside-app-data",
      });
    });
  });

  it("has a sentence for every refusal", () => {
    const reasons: VaultSwitchRefusal[] = [
      "holds-app-data",
      "inside-app-data",
      "vault-pinned-by-env",
      "data-dir-pinned-by-env",
      "already-open",
      "not-a-directory",
    ];
    for (const reason of reasons) {
      expect(switchRefusalMessage(reason).length).toBeGreaterThan(10);
    }
  });
});
