import { describe, expect, it } from "vitest";

import { cloudPlaceholderTarget, isExcludedFileName, isPrunedName } from "../crawl-exclusions";
import { CRAWL_FIXTURE_FILES, CRAWL_FIXTURE_LISTING } from "./crawl-fixture";

/** The predicate applied the way the real walk applies it: prune whole
 * directories by segment, then exclude by file name. A host's walk does
 * exactly this and pins ITSELF against the same fixture in its own package —
 * this is the pure oracle it agrees with. */
function crawledPaths(files: readonly string[]): string[] {
  return files
    .filter((rel) => {
      const segments = rel.split("/");
      const name = segments[segments.length - 1] ?? "";
      return !segments.slice(0, -1).some(isPrunedName) && !isExcludedFileName(name);
    })
    .toSorted();
}

describe("crawl exclusions", () => {
  it("classifies the fixture tree into the expected listing", () => {
    expect(crawledPaths(CRAWL_FIXTURE_FILES)).toEqual(CRAWL_FIXTURE_LISTING);
  });

  // The bug this whole module exists to prevent: a dot-entry pruned here is a
  // file still on disk that the app can no longer reach at all.
  it("keeps dot-entries — only the named tool-owned trees are pruned", () => {
    expect(isPrunedName(".archive")).toBe(false);
    expect(isExcludedFileName(".hidden.md")).toBe(false);
    expect(isExcludedFileName(".gitignore")).toBe(false);
    for (const name of [".git", "node_modules", ".obsidian", ".trash"]) {
      expect(isPrunedName(name)).toBe(true);
      expect(isExcludedFileName(name)).toBe(true);
    }
  });

  // A vault living in or beside a dev repo is ordinary, and every one of these
  // trees is regenerable and potentially gigabytes — crawling them on every
  // refresh is the failure mode this set exists to stop.
  it("prunes tool-owned build and dependency trees", () => {
    for (const name of [
      ".venv",
      ".direnv",
      ".yarn",
      ".next",
      ".turbo",
      ".cache",
      ".pytest_cache",
      ".gradle",
      ".vscode",
      ".idea",
      ".claude",
      ".svn",
      ".hg",
    ]) {
      expect(isPrunedName(name)).toBe(true);
    }
    // Un-dotted lookalikes stay: `cache/` or `next/` is a plausible note folder.
    for (const name of ["cache", "next", "venv", "notes"]) {
      expect(isPrunedName(name)).toBe(false);
    }
  });

  // Volume bookkeeping, present at the root of any external drive or share.
  it("prunes OS volume metadata directories", () => {
    for (const name of [".Spotlight-V100", ".fseventsd", ".TemporaryItems", ".Trashes"]) {
      expect(isPrunedName(name)).toBe(true);
    }
    expect(isPrunedName("$RECYCLE.BIN")).toBe(true);
  });

  it("excludes in-flight atomic-write siblings and OS metadata files", () => {
    expect(isExcludedFileName("note.md.tmp")).toBe(true);
    expect(isExcludedFileName(".DS_Store")).toBe(true);
    expect(isExcludedFileName("Thumbs.db")).toBe(true);
    expect(isExcludedFileName("desktop.ini")).toBe(true);
    // AppleDouble sidecars are derived from the file beside them.
    expect(isExcludedFileName("._note.md")).toBe(true);
    expect(isExcludedFileName("note.md")).toBe(false);
    expect(isExcludedFileName("tmp.md")).toBe(false);
    expect(isExcludedFileName("_note.md")).toBe(false);
  });

  // The stub is evidence about a file the crawl could NOT see. Listing it would
  // present an empty note under a name nothing can open.
  it("maps an iCloud placeholder to the file it stands in for, and never lists it", () => {
    expect(cloudPlaceholderTarget(".note.md.icloud")).toBe("note.md");
    expect(isExcludedFileName(".note.md.icloud")).toBe(true);
    expect(cloudPlaceholderTarget("note.md")).toBeNull();
    // A real note may legitimately end in .icloud; only the dotted stub form is
    // a placeholder.
    expect(cloudPlaceholderTarget("notes-about.icloud")).toBeNull();
    expect(isExcludedFileName("notes-about.icloud")).toBe(false);
    // A stub with nothing between the dot and the suffix names no file.
    expect(cloudPlaceholderTarget(".icloud")).toBeNull();
  });
});
