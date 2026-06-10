import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prependPath, seedDirectory, seedFile } from "./seed";

let tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-runtime-seed-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("seedDirectory", () => {
  it("copies recursively on first run and returns true", () => {
    const root = tmpDir();
    const src = path.join(root, "bundled");
    fs.mkdirSync(path.join(src, "skills", "web"), { recursive: true });
    fs.writeFileSync(path.join(src, "AGENTS.md"), "agents");
    fs.writeFileSync(path.join(src, "skills", "web", "SKILL.md"), "skill");
    const dest = path.join(root, "data");

    expect(seedDirectory(src, dest)).toBe(true);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe("agents");
    expect(fs.readFileSync(path.join(dest, "skills", "web", "SKILL.md"), "utf8")).toBe("skill");
  });

  it("is a no-op when dest already exists — user edits survive re-launch", () => {
    const root = tmpDir();
    const src = path.join(root, "bundled");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "AGENTS.md"), "factory default");
    const dest = path.join(root, "data");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "user edited");

    expect(seedDirectory(src, dest)).toBe(false);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe("user edited");
  });

  it("returns false when src is missing", () => {
    const root = tmpDir();
    const dest = path.join(root, "data");

    expect(seedDirectory(path.join(root, "no-such-src"), dest)).toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
  });
});

describe("seedFile", () => {
  it("copies and creates the parent directory, returns true", () => {
    const root = tmpDir();
    const src = path.join(root, "client_secret.json");
    fs.writeFileSync(src, "secret");
    const dest = path.join(root, "deep", "nested", "client_secret.json");

    expect(seedFile(src, dest)).toBe(true);
    expect(fs.readFileSync(dest, "utf8")).toBe("secret");
  });

  it("never overwrites an existing dest and returns false", () => {
    const root = tmpDir();
    const src = path.join(root, "token.json");
    fs.writeFileSync(src, "new token");
    const dest = path.join(root, "out", "token.json");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "existing token");

    expect(seedFile(src, dest)).toBe(false);
    expect(fs.readFileSync(dest, "utf8")).toBe("existing token");
  });

  it("returns false when src is missing", () => {
    const root = tmpDir();
    const dest = path.join(root, "out", "file.json");

    expect(seedFile(path.join(root, "no-such-file"), dest)).toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("rethrows non-EEXIST errors instead of swallowing them", () => {
    const root = tmpDir();
    const src = path.join(root, "file.json");
    fs.writeFileSync(src, "data");
    // dest's "parent directory" is a regular file → mkdir/copy fails with
    // ENOTDIR, which must propagate (only EEXIST means "already seeded").
    const blocker = path.join(root, "blocker");
    fs.writeFileSync(blocker, "i am a file");

    expect(() => seedFile(src, path.join(blocker, "file.json"))).toThrow();
  });
});

describe("prependPath", () => {
  const originalPath = process.env["PATH"];

  afterEach(() => {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
  });

  it("prepends a missing entry", () => {
    process.env["PATH"] = ["/usr/bin", "/bin"].join(path.delimiter);
    prependPath("/home/me/.inteligir/bin");

    expect(process.env["PATH"]).toBe(
      ["/home/me/.inteligir/bin", "/usr/bin", "/bin"].join(path.delimiter),
    );
  });

  it("is idempotent when the entry is already present anywhere on PATH", () => {
    const before = ["/usr/bin", "/home/me/.inteligir/bin", "/bin"].join(path.delimiter);
    process.env["PATH"] = before;
    prependPath("/home/me/.inteligir/bin");

    expect(process.env["PATH"]).toBe(before);
  });

  it("sets PATH to the entry when PATH is empty", () => {
    process.env["PATH"] = "";
    prependPath("/home/me/.inteligir/bin");

    expect(process.env["PATH"]).toBe("/home/me/.inteligir/bin");
  });
});
