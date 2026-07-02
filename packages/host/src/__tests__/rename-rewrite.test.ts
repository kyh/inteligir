import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { renameWithLinkRewrite } from "../knowledge/rename-rewrite";
import { VaultManager } from "../vault/vault";

let tmp: string;
let root: string;
let vault: VaultManager;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rename-rewrite-test-"));
  root = path.join(tmp, "vault");
  vault = new VaultManager({
    settingsPath: path.join(tmp, "settings.json"),
    defaultRoot: root,
    manageAgentLink: false,
  });
  vault.ensureReady();
});

afterEach(() => {
  vault.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("renameWithLinkRewrite", () => {
  it("renames on disk and rewrites linking docs byte-exactly", () => {
    const hub = [
      "# Hub",
      "",
      "See [[old note]], aliased [[old note|friendly]], and [md](old%20note.md#sec).",
      "",
      "```",
      "[[old note]] in a fence survives",
      "```",
      "",
    ].join("\n");
    vault.writeText("hub.md", hub);
    vault.writeText("old note.md", "# The note\n");

    expect(renameWithLinkRewrite(vault, "old note.md", "sub/new note.md")).toEqual({ ok: true });

    expect(fs.existsSync(path.join(root, "old note.md"))).toBe(false);
    expect(vault.readText("sub/new note.md")).toBe("# The note\n");
    expect(vault.readText("hub.md")).toBe(
      [
        "# Hub",
        "",
        "See [[new note]], aliased [[new note|friendly]], and [md](sub/new%20note.md#sec).",
        "",
        "```",
        "[[old note]] in a fence survives",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("rewrites the moved doc's own self-link and relative links at its new path", () => {
    vault.writeText("a/doc.md", "self [[doc]] plus [sibling](sib.md)\n");
    vault.writeText("a/sib.md", "# Sib\n");

    expect(renameWithLinkRewrite(vault, "a/doc.md", "b/doc.md")).toEqual({ ok: true });
    expect(vault.readText("b/doc.md")).toBe("self [[doc]] plus [sibling](../a/sib.md)\n");
  });

  it("propagates a refused rename and rewrites nothing", () => {
    vault.writeText("hub.md", "[[old]]\n");
    vault.writeText("old.md", "");
    vault.writeText("taken.md", "occupied");

    const result = renameWithLinkRewrite(vault, "old.md", "taken.md");
    expect(result.ok).toBe(false);
    expect(vault.readText("hub.md")).toBe("[[old]]\n");
    expect(vault.readText("old.md")).toBe("");
  });

  it("skips a doc that changed between snapshot and write (concurrent editor wins)", () => {
    class RacyVault extends VaultManager {
      override rename(from: string, to: string): { ok: true } | { ok: false; error: string } {
        const result = super.rename(from, to);
        // Simulate an agent editing hub.md between the snapshot and the writes.
        fs.writeFileSync(path.join(root, "hub.md"), "concurrent edit\n");
        return result;
      }
    }
    const racy = new RacyVault({
      settingsPath: path.join(tmp, "settings-racy.json"),
      defaultRoot: root,
      manageAgentLink: false,
    });
    try {
      racy.writeText("hub.md", "[[old]]\n");
      racy.writeText("old.md", "");
      expect(renameWithLinkRewrite(racy, "old.md", "new.md")).toEqual({ ok: true });
      // The concurrent edit is preserved; the stale rewrite was dropped.
      expect(racy.readText("hub.md")).toBe("concurrent edit\n");
      expect(fs.existsSync(path.join(root, "new.md"))).toBe(true);
    } finally {
      racy.close();
    }
  });
});
