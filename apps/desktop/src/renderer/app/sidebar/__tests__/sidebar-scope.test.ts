import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { visibleEntries } from "../sidebar";

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
  it("hides what the user did not write, and shows everything else", () => {
    expect(visibleEntries(ENTRIES).map((entry) => entry.path)).toEqual([
      "notes",
      "notes/daily",
      "notes/daily/2026-08-16.md",
      "notes/ideas.md",
      "Welcome.md",
    ]);
  });
});
