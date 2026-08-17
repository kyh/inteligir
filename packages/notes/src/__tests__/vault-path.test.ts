import { describe, expect, it } from "vitest";
import {
  isIgnoredEntryName,
  normalizeVaultPath,
  parseVaultPath,
  VaultPathError,
} from "../knowledge/vault-path";

describe("parseVaultPath", () => {
  it("accepts and normalizes ordinary vault paths", () => {
    expect(parseVaultPath("notes/today.md")).toEqual({ ok: true, path: "notes/today.md" });
    expect(parseVaultPath("notes//nested///deep.md")).toEqual({
      ok: true,
      path: "notes/nested/deep.md",
    });
    expect(parseVaultPath("notes/today.md/")).toEqual({ ok: true, path: "notes/today.md" });
    expect(parseVaultPath("Ünïcode départ.md")).toEqual({ ok: true, path: "Ünïcode départ.md" });
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
    const parsed = parseVaultPath(raw);
    expect(parsed.ok).toBe(false);
    expect(() => normalizeVaultPath(raw)).toThrow(VaultPathError);
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
