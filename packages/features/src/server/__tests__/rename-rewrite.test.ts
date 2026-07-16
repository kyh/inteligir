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
    // Phase 3: the old title is recorded as an alias on the moved doc.
    expect(vault.readText("sub/new note.md")).toBe(
      "---\naliases:\n  - old note\n---\n# The note\n",
    );
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

  it("renames a non-md asset and rewrites md image + wiki embed references", () => {
    vault.writeText("hub.md", "shot ![the alt](pic.png), embed ![[pic.png]]\n");
    fs.writeFileSync(path.join(root, "pic.png"), "binary-ish");

    expect(renameWithLinkRewrite(vault, "pic.png", "assets/photo.png")).toEqual({ ok: true });

    expect(fs.existsSync(path.join(root, "pic.png"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "assets/photo.png"), "utf8")).toBe("binary-ish");
    expect(vault.readText("hub.md")).toBe(
      "shot ![the alt](assets/photo.png), embed ![[photo.png]]\n",
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
      // The alias still records — the skipped stale [[old]] link is exactly
      // what it keeps resolving.
      expect(racy.readText("new.md")).toBe("---\naliases:\n  - old\n---\n");
    } finally {
      racy.close();
    }
  });
});

describe("renameWithLinkRewrite — old-title alias (phase 3)", () => {
  it("records the old stem on a retitle even when no links needed rewriting", () => {
    vault.writeText("Meeting Notes.md", "# Meeting Notes\n\nBody.\n");
    expect(renameWithLinkRewrite(vault, "Meeting Notes.md", "Retro.md")).toEqual({ ok: true });
    expect(vault.readText("Retro.md")).toBe(
      "---\naliases:\n  - Meeting Notes\n---\n# Meeting Notes\n\nBody.\n",
    );
  });

  it("appends to an existing alias list and skips a duplicate", () => {
    vault.writeText("a.md", "---\naliases:\n  - Existing\n---\nbody\n");
    expect(renameWithLinkRewrite(vault, "a.md", "b.md")).toEqual({ ok: true });
    expect(vault.readText("b.md")).toBe("---\naliases:\n  - Existing\n  - a\n---\nbody\n");
    // Rename back and forth: "b" gets recorded, then the re-rename to b.md
    // would record "a" again — the ci-duplicate check keeps the list clean.
    expect(renameWithLinkRewrite(vault, "b.md", "a.md")).toEqual({ ok: true });
    expect(renameWithLinkRewrite(vault, "a.md", "b.md")).toEqual({ ok: true });
    expect(vault.readText("b.md")).toBe("---\naliases:\n  - Existing\n  - a\n  - b\n---\nbody\n");
  });

  it("skips case-only retitles and dir-only moves", () => {
    vault.writeText("note.md", "# N\n");
    expect(renameWithLinkRewrite(vault, "note.md", "Note.md")).toEqual({ ok: true });
    expect(vault.readText("Note.md")).toBe("# N\n");
    expect(renameWithLinkRewrite(vault, "Note.md", "sub/Note.md")).toEqual({ ok: true });
    expect(vault.readText("sub/Note.md")).toBe("# N\n");
  });

  it("skips non-docs and unreadable frontmatter (bytes = plain rename)", () => {
    fs.writeFileSync(path.join(root, "pic.png"), "bytes");
    expect(renameWithLinkRewrite(vault, "pic.png", "photo.png")).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(root, "photo.png"), "utf8")).toBe("bytes");

    const invalid = "---\ndup: 1\ndup: 2\n---\nbody\n";
    vault.writeText("weird.md", invalid);
    expect(renameWithLinkRewrite(vault, "weird.md", "renamed weird.md")).toEqual({ ok: true });
    expect(vault.readText("renamed weird.md")).toBe(invalid);
  });
});
