import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import { describe, expect, it } from "vitest";
import { resolveVaultPath } from "../vault-paths";

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
