import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { folderHint } from "../notes-list";
import { entriesUnder } from "../sidebar";

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: ".obsidian" },
  { kind: "file", path: ".obsidian/app.json" },
  { kind: "dir", path: "notes" },
  { kind: "dir", path: "notes/daily" },
  { kind: "file", path: "notes/daily/2026-08-16.md" },
  { kind: "file", path: "notes/ideas.md" },
  { kind: "file", path: "notes/ideas.md.comments.json" },
  { kind: "file", path: "Welcome.md" },
];

describe("what the rail lists", () => {
  it("hides metadata at the root, and shows everything else", () => {
    expect(entriesUnder(ENTRIES, "").map((entry) => entry.path)).toEqual([
      "notes",
      "notes/daily",
      "notes/daily/2026-08-16.md",
      "notes/ideas.md",
      "Welcome.md",
    ]);
  });

  it("scoped to a folder, lists its subtree and not the folder itself", () => {
    expect(entriesUnder(ENTRIES, "notes").map((entry) => entry.path)).toEqual([
      "notes/daily",
      "notes/daily/2026-08-16.md",
      "notes/ideas.md",
    ]);
  });
});

describe("the folder hint beside a recent note", () => {
  it("is spelled from the scope, and empty at the scope itself", () => {
    expect(folderHint("Welcome.md", "")).toBe("");
    expect(folderHint("notes/daily/2026-08-16.md", "")).toBe("notes/daily");
    expect(folderHint("notes/ideas.md", "notes")).toBe("");
    expect(folderHint("notes/daily/2026-08-16.md", "notes")).toBe("daily");
  });
});
