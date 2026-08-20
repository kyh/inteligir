// The memory store reads the directory fresh every call (the files are the
// source of truth — issue #575), validates each file at the boundary, and
// deletes one by a guarded basename. What is pinned: a malformed file is
// surfaced rather than dropped, the read is deterministic, and a delete cannot
// reach outside the directory it was pointed at.

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import {
  deleteMemoryFile,
  InvalidMemoryFileError,
  MemoryFileNotFoundError,
  readMemoryFacts,
  scanMemoryDir,
} from "../memory-store";

function writeFact(
  dir: string,
  file: string,
  frontmatter: string,
  body = "the full note body\n",
): void {
  writeFileSync(join(dir, file), `---\n${frontmatter}\n---\n${body}`, "utf8");
}

describe("scanMemoryDir", () => {
  it("is an empty scan when the directory does not exist", () => {
    const missing = join(makeTempDir("memory-store-"), "not-created");
    expect(scanMemoryDir(missing)).toEqual({ memories: [], malformed: [] });
  });

  it("parses valid facts and orders them by type then name", () => {
    const dir = makeTempDir("memory-store-");
    writeFact(dir, "b.md", "name: Zed\ndescription: last by name\ntype: user");
    writeFact(dir, "a.md", "name: Amy\ndescription: first by name\ntype: user");
    writeFact(dir, "p.md", "name: Concise\ndescription: short commits\ntype: preference");

    const { memories, malformed } = scanMemoryDir(dir);
    expect(malformed).toEqual([]);
    // user before preference (vocabulary order), then by name within a type.
    expect(memories.map((entry) => entry.name)).toEqual(["Amy", "Zed", "Concise"]);
    expect(memories[0]).toEqual({
      file: "a.md",
      name: "Amy",
      description: "first by name",
      type: "user",
      body: "the full note body\n",
    });
  });

  it("defaults an absent description to empty and keeps the body verbatim", () => {
    const dir = makeTempDir("memory-store-");
    writeFact(dir, "x.md", "name: No description\ntype: user", "detail line\n");
    const [fact] = readMemoryFacts(dir);
    expect(fact?.description).toBe("");
    expect(fact?.body).toBe("detail line\n");
  });

  it("surfaces malformed files rather than dropping them", () => {
    const dir = makeTempDir("memory-store-");
    writeFact(dir, "good.md", "name: Good\ndescription: fine\ntype: preference");
    writeFileSync(join(dir, "no-frontmatter.md"), "# just a heading\n", "utf8");
    writeFact(dir, "bad-type.md", "name: Bad type\ndescription: nope\ntype: session");
    writeFact(dir, "no-name.md", "description: nameless\ntype: user");

    const { memories, malformed } = scanMemoryDir(dir);
    expect(memories.map((entry) => entry.file)).toEqual(["good.md"]);
    expect(malformed.map((entry) => entry.file)).toEqual([
      "bad-type.md",
      "no-frontmatter.md",
      "no-name.md",
    ]);
    for (const entry of malformed) {
      expect(entry.problem.length).toBeGreaterThan(0);
    }
  });

  it("reads only flat .md files — dotfiles and directories are skipped", () => {
    const dir = makeTempDir("memory-store-");
    writeFact(dir, "real.md", "name: Real\ndescription: yes\ntype: user");
    writeFileSync(join(dir, "notes.txt"), "not markdown\n", "utf8");
    writeFileSync(join(dir, ".swp.md"), "editor swap\n", "utf8");
    mkdirSync(join(dir, "nested.md"));

    expect(scanMemoryDir(dir).memories.map((entry) => entry.file)).toEqual(["real.md"]);
  });
});

describe("deleteMemoryFile", () => {
  it("removes a file by its basename", () => {
    const dir = makeTempDir("memory-store-");
    writeFact(dir, "gone.md", "name: Gone\ndescription: soon\ntype: user");
    deleteMemoryFile(dir, "gone.md");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses a missing file with a not-found error", () => {
    const dir = makeTempDir("memory-store-");
    expect(() => deleteMemoryFile(dir, "nope.md")).toThrow(MemoryFileNotFoundError);
  });

  it("refuses a traversal, an absolute path, and a nested path", () => {
    const dir = makeTempDir("memory-store-");
    expect(() => deleteMemoryFile(dir, "../escape.md")).toThrow(InvalidMemoryFileError);
    expect(() => deleteMemoryFile(dir, "/etc/passwd")).toThrow(InvalidMemoryFileError);
    expect(() => deleteMemoryFile(dir, "sub/inner.md")).toThrow(InvalidMemoryFileError);
    expect(() => deleteMemoryFile(dir, "not-markdown.txt")).toThrow(InvalidMemoryFileError);
  });
});
