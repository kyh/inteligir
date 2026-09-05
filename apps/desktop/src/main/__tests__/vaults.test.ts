import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "inteligir/server/testing";
import { describe, expect, it } from "vitest";
import type { ServerTarget } from "../server-instance";
import {
  forgetVault,
  planVaultSwitch,
  readRecentVaults,
  RECENT_VAULTS_LIMIT,
  rememberVault,
  switchBlockedBy,
  switchRefusalMessage,
  vaultRef,
  writeRecentVaults,
  type VaultSwitchRefusal,
} from "../vaults";

function target(overrides: Partial<ServerTarget> = {}): ServerTarget {
  return {
    dataDir: "/home/me/.inteligir",
    rootDataDir: "/home/me/.inteligir",
    vaultDir: "/home/me/Inteligir",
    vaultDirSource: "default",
    dataDirSource: "default",
    ...overrides,
  };
}

describe("what may be switched", () => {
  it("switches an owned child to another folder that exists", () => {
    const folder = makeTempDir("inteligir-vault-");
    expect(planVaultSwitch({ ownsServer: true, current: target() }, folder)).toEqual({
      kind: "switch",
    });
  });

  it("refuses a folder that is gone before anything is stopped", () => {
    expect(planVaultSwitch({ ownsServer: true, current: target() }, "/home/me/Gone")).toEqual({
      kind: "refused",
      reason: "not-a-directory",
    });
  });

  it("refuses to restart a server the shell did not start", () => {
    expect(switchBlockedBy({ ownsServer: false, current: target() })).toBe("adopted-server");
  });

  it("refuses while the env pins the vault or the data dir", () => {
    expect(switchBlockedBy({ ownsServer: true, current: target({ vaultDirSource: "env" }) })).toBe(
      "vault-pinned-by-env",
    );
    expect(switchBlockedBy({ ownsServer: true, current: target({ dataDirSource: "env" }) })).toBe(
      "data-dir-pinned-by-env",
    );
  });

  it("refuses the vault already open, however it is spelled", () => {
    expect(planVaultSwitch({ ownsServer: true, current: target() }, "/home/me/Inteligir/")).toEqual(
      { kind: "refused", reason: "already-open" },
    );
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
      path: "/home/me/Work Notes",
      name: "Work Notes",
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
    expect(again.filter((path) => path === "/v/5")).toHaveLength(1);
    expect(forgetVault(again, "/v/5")).not.toContain("/v/5");
  });

  it("round-trips through its file and starts over on bytes that are not a list", () => {
    const filePath = join(makeTempDir("inteligir-recent-vaults-"), "recent-vaults.json");
    const warnings: string[] = [];
    expect(readRecentVaults(filePath, (message) => warnings.push(message))).toEqual([]);
    writeRecentVaults(filePath, ["/v/a", "/v/b"]);
    expect(readRecentVaults(filePath, (message) => warnings.push(message))).toEqual([
      "/v/a",
      "/v/b",
    ]);
    expect(warnings).toEqual([]);
    writeFileSync(filePath, "{not json", "utf8");
    expect(readRecentVaults(filePath, (message) => warnings.push(message))).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});
