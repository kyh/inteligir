// The edge cases every gate in this process has to agree on. Each assertion
// below is a path that reads as contained under one plausible spelling of the
// check and as an escape under another, which is the whole reason there is
// exactly one spelling.

import { describe, expect, it } from "vitest";
import {
  assertMemoryDirOutsideVault,
  assertModelDirOutsideVault,
  assertVaultAndDataDirDisjoint,
  pathContains,
  relativeUnder,
} from "../path-containment";

describe("pathContains", () => {
  it("counts the root itself and refuses a sibling with a shared prefix", () => {
    expect(pathContains("/vault", "/vault")).toBe(true);
    expect(pathContains("/vault", "/vault/notes/today.md")).toBe(true);
    expect(pathContains("/vault", "/vault-backup/notes.md")).toBe(false);
    expect(pathContains("/vault", "/other")).toBe(false);
  });
});

describe("relativeUnder", () => {
  it("answers a /-joined relative path for entries under the root", () => {
    expect(relativeUnder("/vault", "/vault/notes/today.md")).toBe("notes/today.md");
  });

  it("refuses the root itself, an escape, and a sibling with a shared prefix", () => {
    expect(relativeUnder("/vault", "/vault")).toBeNull();
    expect(relativeUnder("/vault", "/etc/passwd")).toBeNull();
    expect(relativeUnder("/vault", "/vault/../escape.md")).toBeNull();
    expect(relativeUnder("/vault", "/vault-backup/notes.md")).toBeNull();
  });

  it("keeps a root entry whose name merely starts with dots", () => {
    expect(relativeUnder("/vault", "/vault/..draft.md")).toBe("..draft.md");
  });
});

describe("assertVaultAndDataDirDisjoint", () => {
  it("refuses either nesting and allows siblings", () => {
    expect(() => assertVaultAndDataDirDisjoint("/home/vault", "/home/vault/.data")).toThrow(
      /must be disjoint/u,
    );
    expect(() => assertVaultAndDataDirDisjoint("/home/data/vault", "/home/data")).toThrow(
      /must be disjoint/u,
    );
    expect(() => assertVaultAndDataDirDisjoint("/home/vault", "/home/vault-data")).not.toThrow();
  });
});

describe("assertModelDirOutsideVault", () => {
  it("refuses a model dir inside the vault — it would be committed and pushed", () => {
    expect(() => assertModelDirOutsideVault("/home/vault/models", "/home/vault")).toThrow(
      /outside the vault/u,
    );
    expect(() => assertModelDirOutsideVault("/home/models", "/home/models/vault")).toThrow(
      /outside the vault/u,
    );
  });

  it("allows the default, which sits under the data dir, not the vault", () => {
    // The model dir DEFAULTS to <dataDir>/models; only the vault is checked,
    // because a cache the data dir owns is intended.
    expect(() =>
      assertModelDirOutsideVault("/home/.inteligir/models", "/home/Inteligir"),
    ).not.toThrow();
    expect(() => assertModelDirOutsideVault("/home/vault-models", "/home/vault")).not.toThrow();
  });
});

describe("assertMemoryDirOutsideVault", () => {
  it("refuses a memory dir inside the vault — a fact would be committed and pushed", () => {
    expect(() => assertMemoryDirOutsideVault("/home/vault/memory", "/home/vault")).toThrow(
      /outside the vault/u,
    );
    expect(() => assertMemoryDirOutsideVault("/home/memory", "/home/memory/vault")).toThrow(
      /outside the vault/u,
    );
  });

  it("allows the default under ~/.inteligir and a sibling of the vault", () => {
    expect(() =>
      assertMemoryDirOutsideVault("/home/.inteligir/memory", "/home/Inteligir"),
    ).not.toThrow();
    expect(() => assertMemoryDirOutsideVault("/home/vault-memory", "/home/vault")).not.toThrow();
  });
});
