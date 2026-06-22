import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VaultManager } from "@/main/vault";

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

  it("serializes and parses JSON blobs via writeAuto/readAuto", () => {
    const mgr = newManager();
    mgr.writeAuto("data/habits.json", { streak: 3, items: ["a", "b"] });
    expect(mgr.readAuto("data/habits.json")).toEqual({ streak: 3, items: ["a", "b"] });
    // On disk it is valid, pretty-printed JSON.
    const onDisk = fs.readFileSync(path.join(root, "data/habits.json"), "utf8");
    expect(JSON.parse(onDisk)).toEqual({ streak: 3, items: ["a", "b"] });
    expect(mgr.list()).toContainEqual({
      path: "data/habits.json",
      name: "habits.json",
      kind: "blob",
    });
  });

  it("returns raw text from readAuto for non-JSON files", () => {
    const mgr = newManager();
    mgr.writeAuto("note.md", "plain text");
    expect(mgr.readAuto("note.md")).toBe("plain text");
  });

  it("refuses to write undefined instead of corrupting the file", () => {
    const mgr = newManager();
    expect(() => mgr.writeAuto("data/x.json", undefined)).toThrow(/undefined/);
    expect(() => mgr.writeAuto("note.md", undefined)).toThrow(/undefined/);
    expect(fs.existsSync(path.join(root, "data/x.json"))).toBe(false);
  });

  it("surfaces malformed JSON instead of resetting the file", () => {
    const mgr = newManager();
    mgr.writeText("broken.json", "{ not json");
    expect(() => mgr.readAuto("broken.json")).toThrow(/valid JSON/i);
    // The bytes survive — never quarantined or reset.
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
