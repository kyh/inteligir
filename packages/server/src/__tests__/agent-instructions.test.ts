// ---------------------------------------------------------------------------
// agent-instructions: the load half must no-op (null) when vault/AGENTS.md is
// absent or opted out, and the seed half must be once-per-vault, no-clobber,
// and deletion-respecting — the skeleton never overwrites user bytes and
// never resurrects after the user deletes it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { AGENT_INSTRUCTIONS_SKELETON } from "@repo/bridge/agent-instructions";
import {
  boundInstructionsContent,
  loadInstructionsFrom,
  seedInstructionsInto,
  type InstructionsVault,
  type SeedMarks,
} from "../agent-instructions/agent-instructions";

/** In-memory vault fake mirroring VaultManager's contract: readText throws
 * ENOENT-shaped errors for absent files, writeText replaces bytes. */
function fakeVault(files: Map<string, string>, root = "/vault"): InstructionsVault {
  return {
    root: () => root,
    readText: (rel) => {
      const content = files.get(rel);
      if (content === undefined) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: ${rel}`);
        err.code = "ENOENT";
        throw err;
      }
      return content;
    },
    writeText: (rel, content) => void files.set(rel, content),
  };
}

function fakeMarks(): SeedMarks {
  const roots = new Set<string>();
  return { has: (root) => roots.has(root), add: (root) => void roots.add(root) };
}

describe("loadInstructionsFrom", () => {
  it("returns the file as a ./vault-labeled context file", () => {
    const vault = fakeVault(new Map([["AGENTS.md", "# Hi\n\nAlways answer in Spanish.\n"]]));
    expect(loadInstructionsFrom(vault)).toEqual({
      path: "./vault/AGENTS.md",
      content: "# Hi\n\nAlways answer in Spanish.\n",
    });
  });

  it("is a no-op (null) when the file is absent", () => {
    expect(loadInstructionsFrom(fakeVault(new Map()))).toBeNull();
  });

  it("is a no-op (null) when a read fails for any other reason", () => {
    const vault = fakeVault(new Map());
    vault.readText = () => {
      throw new Error("EACCES");
    };
    expect(loadInstructionsFrom(vault)).toBeNull();
  });

  it("honors a private: true mark — excluded like every AI surface", () => {
    const vault = fakeVault(new Map([["AGENTS.md", "---\nprivate: true\n---\n\nSecret.\n"]]));
    expect(loadInstructionsFrom(vault)).toBeNull();
  });

  it("treats unparseable frontmatter as private (fail-closed)", () => {
    const vault = fakeVault(new Map([["AGENTS.md", "---\n{ not yaml\n---\n\nBody.\n"]]));
    expect(loadInstructionsFrom(vault)).toBeNull();
  });

  it("bounds an over-budget file before it reaches the prompt", () => {
    const oversized = `# Rules\n\nAlways answer in Spanish.\n${"- remembered fact\n".repeat(2_000)}`;
    const entry = loadInstructionsFrom(fakeVault(new Map([["AGENTS.md", oversized]])));
    expect(entry).not.toBeNull();
    expect(entry?.content.length).toBeLessThan(oversized.length);
    expect(entry?.content).toContain("Always answer in Spanish.");
    expect(entry?.content).toContain("exceeded its instruction budget");
  });
});

const over = (chars: number) => "x".repeat(chars);

describe("boundInstructionsContent", () => {
  it("passes a within-budget file through byte-identically", () => {
    const content = "# Rules\n\nBe terse.\n";
    expect(boundInstructionsContent(content)).toEqual({ content, droppedChars: 0 });
  });

  it("keeps the head — standing instructions survive, appended memory is shed", () => {
    const content = `MUST: answer in Spanish.\n${"- fact\n".repeat(5_000)}`;
    const { content: bounded, droppedChars } = boundInstructionsContent(content);
    expect(bounded).toContain("MUST: answer in Spanish.");
    expect(droppedChars).toBeGreaterThan(0);
    expect(bounded.length).toBeLessThan(content.length);
  });

  it("cuts on a line boundary so no half-rule reaches the model", () => {
    const line = `${over(100)}\n`;
    const { content } = boundInstructionsContent(line.repeat(1_000));
    const body = content.slice(0, content.indexOf("[vault/AGENTS.md"));
    for (const l of body.split("\n").filter(Boolean)) expect(l).toHaveLength(100);
  });

  it("reports the dropped byte count", () => {
    const content = over(20_000);
    const { droppedChars } = boundInstructionsContent(content);
    expect(droppedChars).toBe(content.length - 16_000);
  });
});

describe("seedInstructionsInto", () => {
  it("seeds the skeleton into a vault that has never had one", () => {
    const files = new Map<string, string>();
    seedInstructionsInto(fakeVault(files), fakeMarks());
    expect(files.get("AGENTS.md")).toBe(AGENT_INSTRUCTIONS_SKELETON);
  });

  it("is idempotent — a second pass never rewrites", () => {
    const files = new Map<string, string>();
    const marks = fakeMarks();
    const vault = fakeVault(files);
    seedInstructionsInto(vault, marks);
    files.set("AGENTS.md", "user edited this");
    seedInstructionsInto(vault, marks);
    expect(files.get("AGENTS.md")).toBe("user edited this");
  });

  it("never clobbers a pre-existing user file — marks it seeded instead", () => {
    const files = new Map([["AGENTS.md", "mine"]]);
    const marks = fakeMarks();
    seedInstructionsInto(fakeVault(files), marks);
    expect(files.get("AGENTS.md")).toBe("mine");
    expect(marks.has("/vault")).toBe(true);
  });

  it("respects deletion — a seeded-then-deleted file stays deleted", () => {
    const files = new Map<string, string>();
    const marks = fakeMarks();
    const vault = fakeVault(files);
    seedInstructionsInto(vault, marks);
    files.delete("AGENTS.md"); // the user removed it
    seedInstructionsInto(vault, marks);
    expect(files.has("AGENTS.md")).toBe(false);
  });

  it("seeds each vault root independently", () => {
    const marks = fakeMarks();
    const a = new Map<string, string>();
    const b = new Map<string, string>();
    seedInstructionsInto(fakeVault(a, "/vault-a"), marks);
    seedInstructionsInto(fakeVault(b, "/vault-b"), marks);
    expect(a.get("AGENTS.md")).toBe(AGENT_INSTRUCTIONS_SKELETON);
    expect(b.get("AGENTS.md")).toBe(AGENT_INSTRUCTIONS_SKELETON);
  });

  it("does not write blind when the existing file is unreadable (non-ENOENT)", () => {
    const files = new Map<string, string>();
    const marks = fakeMarks();
    const vault = fakeVault(files);
    vault.readText = () => {
      throw new Error("EACCES");
    };
    seedInstructionsInto(vault, marks);
    expect(files.size).toBe(0);
    expect(marks.has("/vault")).toBe(false);
  });
});
