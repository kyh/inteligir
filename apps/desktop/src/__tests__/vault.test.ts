import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VaultManager, resumeVaultWrites, suspendVaultWrites } from "@/main/vault";

let tmp: string;
let root: string;
let settingsPath: string;

function newManager(): VaultManager {
  return new VaultManager({ settingsPath, defaultRoot: root, manageAgentLink: false });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-test-"));
  root = path.join(tmp, "vault");
  settingsPath = path.join(tmp, "settings.json");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("VaultManager", () => {
  it("defaults to the provided root and creates it on ensureReady", () => {
    const mgr = newManager();
    expect(mgr.getRoot()).toBe(root);
    mgr.ensureReady();
    expect(fs.existsSync(root)).toBe(true);
  });

  it("round-trips text docs and lists them", () => {
    const mgr = newManager();
    mgr.writeText("notes/hello.md", "# Hi");
    expect(mgr.readText("notes/hello.md")).toBe("# Hi");
    const list = mgr.list();
    expect(list).toContainEqual({ path: "notes/hello.md", name: "hello.md", kind: "doc" });
  });

  it("excludes sibling .tmp files from the listing", () => {
    const mgr = newManager();
    mgr.writeText("note.md", "hi");
    fs.writeFileSync(path.join(root, "note.md.tmp"), "in-flight");
    const names = mgr.list().map((e) => e.path);
    expect(names).toContain("note.md");
    expect(names).not.toContain("note.md.tmp");
  });

  it("read-through never resets a malformed file — the bytes survive", () => {
    const mgr = newManager();
    mgr.writeText("broken.json", "{ not json");
    // Unlike JsonStore, the vault reads through to disk and never quarantines
    // or rewrites user-owned files.
    expect(mgr.readText("broken.json")).toBe("{ not json");
  });

  it("confines paths to the vault root", () => {
    const mgr = newManager();
    mgr.ensureReady();
    expect(() => mgr.readText("../escape.md")).toThrow(/escapes the vault/);
    expect(() => mgr.writeText("../../evil.md", "x")).toThrow(/escapes the vault/);
    expect(() => mgr.writeText("/etc/passwd", "x")).toThrow(/escapes the vault/);
  });

  it("deletes files", () => {
    const mgr = newManager();
    mgr.writeText("temp.md", "x");
    expect(mgr.delete("temp.md")).toBe(true);
    expect(mgr.delete("temp.md")).toBe(false);
    expect(fs.existsSync(path.join(root, "temp.md"))).toBe(false);
  });

  it("refuses a root inside the app data dir (wiped on logout)", () => {
    const mgr = newManager();
    const inside = path.join(os.homedir(), ".inteligir", "vault");
    expect(() => mgr.setRoot(inside)).toThrow(/app data directory/);
    // The root is unchanged.
    expect(mgr.getRoot()).toBe(root);
  });

  it("blocks writes while suspended (signed out) and resumes after", () => {
    const mgr = newManager();
    mgr.writeText("a.md", "before");
    suspendVaultWrites();
    try {
      expect(() => mgr.writeText("a.md", "during")).toThrow(/signed out/);
      expect(() => mgr.delete("a.md")).toThrow(/signed out/);
      // The pre-suspension content is untouched.
      expect(mgr.readText("a.md")).toBe("before");
    } finally {
      resumeVaultWrites();
    }
    mgr.writeText("a.md", "after");
    expect(mgr.readText("a.md")).toBe("after");
  });

  it("repoints the root and persists it across instances", () => {
    const mgr = newManager();
    mgr.writeText("a.md", "first");
    const next = path.join(tmp, "other-vault");
    mgr.setRoot(next);
    expect(mgr.getRoot()).toBe(next);
    expect(mgr.list()).toEqual([]);
    mgr.writeText("b.md", "second");
    // A fresh manager reads the persisted root.
    const reopened = newManager();
    expect(reopened.getRoot()).toBe(next);
    expect(reopened.readText("b.md")).toBe("second");
  });
});
