import { describe, expect, it } from "vitest";
import { resolveVaultEntry } from "../vault-entry";

const VAULT = "/Users/me/vault";

// what the disk would answer: the vault root, its entries, and one symlink pointing out
const REAL = new Map<string, string>([
  [VAULT, VAULT],
  [`${VAULT}/Welcome.md`, `${VAULT}/Welcome.md`],
  [`${VAULT}/notes`, `${VAULT}/notes`],
  [`${VAULT}/notes/ideas.md`, `${VAULT}/notes/ideas.md`],
  [`${VAULT}/keys.md`, "/Users/me/.ssh/id_ed25519"],
]);

const realpath = (candidate: string): string => {
  const real = REAL.get(candidate);
  if (real === undefined) {
    throw new Error(`ENOENT ${candidate}`);
  }
  return real;
};

const resolve = (path: string) => resolveVaultEntry({ path, realpath, vaultDir: VAULT });

describe("an entry the page asks the OS to show", () => {
  it("resolves to its real path under the vault", () => {
    expect(resolve("notes/ideas.md")).toEqual({ absPath: `${VAULT}/notes/ideas.md`, ok: true });
    expect(resolve("Welcome.md")).toEqual({ absPath: `${VAULT}/Welcome.md`, ok: true });
  });

  it("refuses a path that climbs out or is absolute, before touching the disk", () => {
    expect(resolve("../secret.md").ok).toBe(false);
    expect(resolve("/etc/passwd").ok).toBe(false);
    expect(resolve("notes/../../x.md").ok).toBe(false);
  });

  it("refuses a symlink whose real target is outside the vault", () => {
    expect(resolve("keys.md")).toEqual({ ok: false, reason: "keys.md is not in the vault" });
  });

  it("refuses what the disk does not hold", () => {
    expect(resolve("missing.md").ok).toBe(false);
  });

  it("refuses the root itself", () => {
    expect(resolve(".").ok).toBe(false);
  });
});
