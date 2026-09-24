import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { recentRows } from "../notes-list";

const note = (path: string, modifiedMs: number): VaultEntry => ({ kind: "file", modifiedMs, path });

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: "notes" },
  note("notes/old.md", 1000),
  note("notes/new.md", 5000),
  note("pinned-old.md", 500),
  note("pinned-new.md", 600),
  note("assets/logo.png", 9000),
  note("mid.txt", 3000),
  note("newest.md", 7000),
];

const PINNED: ReadonlySet<string> = new Set(["pinned-old.md", "pinned-new.md"]);

const paths = (limit?: number): string[] =>
  recentRows(ENTRIES, PINNED, limit).map((entry) => entry.path);

describe("the Recent view's rows", () => {
  it("lists the pinned notes first, then the rest, each newest first, docs alone", () => {
    expect(paths()).toEqual([
      "pinned-new.md",
      "pinned-old.md",
      "newest.md",
      "notes/new.md",
      "mid.txt",
      "notes/old.md",
    ]);
  });

  it("caps the unpinned rows alone", () => {
    expect(paths(2)).toEqual(["pinned-new.md", "pinned-old.md", "newest.md", "notes/new.md"]);
  });
});
