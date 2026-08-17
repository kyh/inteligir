// The edge cases every gate in this process has to agree on. Each assertion
// below is a path that reads as contained under one plausible spelling of the
// check and as an escape under another, which is the whole reason there is
// exactly one spelling.

import { describe, expect, it } from "vitest";
import { assertVaultAndDataDirDisjoint, pathContains, relativeUnder } from "../path-containment";

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
