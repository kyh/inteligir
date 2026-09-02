// The cloud wire's vault-path grammar IS the vault engine's own
// (`parseVaultPath`, verbatim). One corpus through both deciders keeps them in
// lockstep; the expectation is DERIVED from the engine, so a value they
// disagree on is named rather than hand-listed.

import { parseVaultPath } from "@repo/notes/knowledge/vault-path";
import { describe, expect, it } from "vitest";
import { vaultFileQuerySchema } from "../vault/vault-schema";

/** What the wire says about `path`. The schema is not exported on its own —
 *  a query row is how every caller meets it. */
function wireAdmits(path: string): boolean {
  return vaultFileQuerySchema.safeParse({ path }).success;
}

/** Admitted iff the engine parses it AND the parse is the identity — these
 *  values address git trees verbatim, so a path the engine would normalize
 *  must refuse rather than silently rename. */
function engineAdmits(path: string): boolean {
  const parsed = parseVaultPath(path);
  return parsed.ok && parsed.path === path;
}

const CORPUS = [
  "a.md",
  "notes/b.md",
  "Notes/Deep/c file.md",
  "α β.png",
  ".hidden/x.md",
  "trash/x.md",
  "git/config",
  "",
  "/rooted.md",
  "../up.md",
  "a/../b.md",
  "a//b.md",
  "a/./b.md",
  "a\\b.md",
  "a\0b.md",
  "a/",
  ".git/config",
  ".GIT/hooks/x",
  "notes/.Git/config",
  ".inteligir-tmp-x/y",
  "a/.inteligir-tmp-1",
  "x".repeat(1025),
];

describe("the vault-path grammar has one spelling", () => {
  it("the wire admits exactly what the engine admits verbatim, over the whole corpus", () => {
    for (const path of CORPUS) {
      expect(wireAdmits(path), JSON.stringify(path)).toBe(engineAdmits(path));
    }
  });

  it("refuses case-folded .git and backslash separators absolutely", () => {
    // Case-folded `.git` reaches git's machinery on a case-insensitive
    // filesystem, and a backslash path means different files per platform.
    expect(wireAdmits(".GIT/hooks/x")).toBe(false);
    expect(wireAdmits("a\\b.md")).toBe(false);
  });
});
