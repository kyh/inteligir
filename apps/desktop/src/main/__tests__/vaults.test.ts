import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir, TEMP_DIR_FOLDS_CASE } from "inteligir/server/testing";
import { describe, expect, it } from "vitest";
import type { ServerTarget } from "../server-instance";
import {
  forgetVault,
  offeredRecentVaults,
  planVaultSwitch,
  readRecentVaults,
  RECENT_VAULTS_LIMIT,
  rememberVault,
  switchBlockedBy,
  switchRefusalMessage,
  vaultRef,
  writeRecentVaults,
} from "../vaults";
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

describe("what may be switched", () => {
  it("switches an owned child to another folder that exists", () => {
    const folder = makeTempDir("inteligir-vault-");
    expect(planVaultSwitch({ current: target(), ownsServer: true }, folder)).toEqual({
      kind: "switch",
    });
  });

  it("refuses a folder that is gone before anything is stopped", () => {
    expect(planVaultSwitch({ current: target(), ownsServer: true }, "/home/me/Gone")).toEqual({
      kind: "refused",
      reason: "not-a-directory",
    });
  });

  it("refuses to restart a server the shell did not start", () => {
    expect(switchBlockedBy({ current: target(), ownsServer: false })).toBe("adopted-server");
  });

  it("refuses while the env pins the vault or the data dir", () => {
    expect(switchBlockedBy({ current: target({ vaultDirSource: "env" }), ownsServer: true })).toBe(
      "vault-pinned-by-env",
    );
    expect(switchBlockedBy({ current: target({ dataDirSource: "env" }), ownsServer: true })).toBe(
      "data-dir-pinned-by-env",
    );
  });

  it("refuses the vault already open, however it is spelled", () => {
    expect(planVaultSwitch({ current: target(), ownsServer: true }, "/home/me/Inteligir/")).toEqual(
      { kind: "refused", reason: "already-open" },
    );
  });

  describe("refuses the vault already open when the picker names the same folder", () => {
    it("through a symlink", () => {
      const vaultDir = openVault();
      const linked = path.join(path.dirname(vaultDir), "Linked");
      symlinkSync(vaultDir, linked);
      expect(planVaultSwitch({ current: target({ vaultDir }), ownsServer: true }, linked)).toEqual({
        kind: "refused",
        reason: "already-open",
      });
    });

    it.skipIf(!TEMP_DIR_FOLDS_CASE)("in another case, where the volume folds case", () => {
      const vaultDir = openVault();
      const respelled = path.join(path.dirname(vaultDir), "notes");
      expect(
        planVaultSwitch({ current: target({ vaultDir }), ownsServer: true }, respelled),
      ).toEqual({ kind: "refused", reason: "already-open" });
    });
  });

  it("has a sentence for every refusal", () => {
    const reasons: VaultSwitchRefusal[] = [
      "adopted-server",
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

describe("the remembered list", () => {
  it("names a vault by its folder", () => {
    expect(vaultRef("/home/me/Work Notes")).toEqual({
      name: "Work Notes",
      path: "/home/me/Work Notes",
    });
    expect(vaultRef("/").name).toBe("/");
  });

  it("puts the latest first, once, and caps the list", () => {
    let recent: string[] = [];
    for (let n = 0; n < RECENT_VAULTS_LIMIT + 3; n += 1) {
      recent = rememberVault(recent, `/v/${String(n)}`);
    }
    expect(recent).toHaveLength(RECENT_VAULTS_LIMIT);
    expect(recent[0]).toBe(`/v/${String(RECENT_VAULTS_LIMIT + 2)}`);
    const again = rememberVault(recent, "/v/5");
    expect(again[0]).toBe("/v/5");
    expect(again.filter((each) => each === "/v/5")).toHaveLength(1);
    expect(forgetVault(again, "/v/5")).not.toContain("/v/5");
  });

  it("offers neither the vault already open nor a folder that is gone, and keeps the order", () => {
    const present = new Set(["/v/a", "/v/open", "/v/c"]);
    const exists = (vaultPath: string): boolean => present.has(vaultPath);
    const recent = ["/v/open", "/v/a", "/v/unmounted", "/v/c"];
    expect(offeredRecentVaults(recent, "/v/open", exists)).toEqual(["/v/a", "/v/c"]);
    // before the first boot there is no vault open to leave out
    expect(offeredRecentVaults(recent, null, exists)).toEqual(["/v/open", "/v/a", "/v/c"]);
  });

  it("round-trips through its file and starts over on bytes that are not a list", () => {
    const filePath = path.join(makeTempDir("inteligir-recent-vaults-"), "recent-vaults.json");
    const warnings: string[] = [];
    const warn = (message: string): void => {
      warnings.push(message);
    };
    expect(readRecentVaults(filePath, warn)).toEqual([]);
    writeRecentVaults(filePath, ["/v/a", "/v/b"]);
    expect(readRecentVaults(filePath, warn)).toEqual(["/v/a", "/v/b"]);
    expect(warnings).toEqual([]);
    writeFileSync(filePath, "{not json", "utf-8");
    expect(readRecentVaults(filePath, warn)).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});
