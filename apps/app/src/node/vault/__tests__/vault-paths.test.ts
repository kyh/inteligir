import { describe, expect, it } from "vitest";
import {
  isIgnoredEntryName,
  normalizeVaultPath,
  resolveVaultPath,
  VaultPathError,
} from "../vault-paths";

describe("normalizeVaultPath", () => {
  it("accepts and normalizes ordinary vault paths", () => {
    expect(normalizeVaultPath("notes/today.md")).toBe("notes/today.md");
    expect(normalizeVaultPath("notes//nested///deep.md")).toBe("notes/nested/deep.md");
    expect(normalizeVaultPath("notes/today.md/")).toBe("notes/today.md");
    expect(normalizeVaultPath("Ünïcode départ.md")).toBe("Ünïcode départ.md");
  });

  it.each([
    ["", "empty"],
    ["../outside.md", "leading dotdot"],
    ["notes/../../outside.md", "nested dotdot"],
    ["..", "bare dotdot"],
    ["/etc/passwd", "absolute"],
    ["notes/./today.md", "dot segment"],
    ["notes\\today.md", "backslash separator"],
    ["notes/tod\0ay.md", "null byte"],
    [".git/config", "the repo dir"],
    ["nested/.GIT/config", "the repo dir, any case, any depth"],
    [".inteligir-tmp-abc123", "a staging file"],
    ["a".repeat(2000), "unreasonable length"],
  ])("refuses %s (%s)", (raw) => {
    expect(() => normalizeVaultPath(raw)).toThrow(VaultPathError);
  });
});

describe("resolveVaultPath", () => {
  it("resolves inside the root", () => {
    const { relPath, absPath } = resolveVaultPath("/vault/root", "notes/today.md");
    expect(relPath).toBe("notes/today.md");
    expect(absPath).toBe("/vault/root/notes/today.md");
  });

  it("refuses traversal even when normalize is bypassed by odd input", () => {
    expect(() => resolveVaultPath("/vault/root", "notes/../../etc/passwd")).toThrow(VaultPathError);
  });
});

describe("isIgnoredEntryName", () => {
  it("hides repo metadata and staging files", () => {
    expect(isIgnoredEntryName(".git")).toBe(true);
    expect(isIgnoredEntryName(".GIT")).toBe(true);
    expect(isIgnoredEntryName(".inteligir-tmp-deadbeef")).toBe(true);
    expect(isIgnoredEntryName(".gitignore")).toBe(false);
    expect(isIgnoredEntryName("notes")).toBe(false);
  });
});
