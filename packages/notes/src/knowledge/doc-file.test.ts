import { describe, expect, it } from "vitest";
import {
  docExtension,
  docStem,
  isDocPath,
  isDotEntryPath,
  wikiLinkName,
  wikiLinkPath,
} from "./doc-file";
import { pathCollisionKey } from "./folder-path";

describe("what counts as a doc", () => {
  it("names every extension the index and the listing carry", () => {
    for (const path of ["a.md", "a.markdown", "a.mdx", "a.txt", "notes/README.TXT"]) {
      expect(isDocPath(path)).toBe(true);
    }
    for (const path of ["a.png", "a", "assets/logo.svg", ".gitignore"]) {
      expect(isDocPath(path)).toBe(false);
    }
  });
});

describe("what a listing hides", () => {
  it("hides every dot-entry, the annotation store included, at any depth", () => {
    for (const path of [
      ".inteligir/annotations/7d1c.json",
      ".obsidian/app.json",
      "notes/.DS_Store",
      ".trash",
    ]) {
      expect(isDotEntryPath(path)).toBe(true);
    }
  });

  it("shows notes, folders, attachments and the user's own json, whatever its name", () => {
    for (const path of [
      "Welcome.md",
      "notes",
      "notes/annotations.json",
      "assets/logo.png",
      "Welcome.md.annotations.json",
      "notes/meeting.annotations.json",
    ]) {
      expect(isDotEntryPath(path)).toBe(false);
    }
  });
});

describe("the stem a title surface edits", () => {
  it("drops the doc extension, spelled as it is on disk", () => {
    expect(docStem("notes/daily/2026-08-16.md")).toBe("2026-08-16");
    expect(docStem("notes/spec.markdown")).toBe("spec");
    expect(docStem("page.mdx")).toBe("page");
    expect(docStem("README.txt")).toBe("README");
    expect(docStem("Notes.MD")).toBe("Notes");
  });

  it("leaves a file that is not a doc its whole basename", () => {
    expect(docStem("assets/logo.png")).toBe("logo.png");
    expect(docStem("Makefile")).toBe("Makefile");
  });

  it("hands back the extension the stem has to be rejoined to", () => {
    expect(docExtension("notes/spec.markdown")).toBe(".markdown");
    expect(docExtension("Notes.MD")).toBe(".MD");
    expect(docExtension("assets/logo.png")).toBe("");
    expect(`${docStem("notes/spec.markdown")}${docExtension("notes/spec.markdown")}`).toBe(
      "spec.markdown",
    );
  });
});

describe("the name a wiki link spells", () => {
  it("leaves off `.md` alone, in any case", () => {
    expect(wikiLinkName("notes/Plan.md")).toBe("Plan");
    expect(wikiLinkName("Notes.MD")).toBe("Notes");
    expect(wikiLinkPath("notes/Plan.md")).toBe("notes/Plan");
  });

  it("keeps every other extension, doc or not", () => {
    expect(wikiLinkName("notes/todo.txt")).toBe("todo.txt");
    expect(wikiLinkName("spec.markdown")).toBe("spec.markdown");
    expect(wikiLinkName("assets/logo.png")).toBe("logo.png");
    expect(wikiLinkPath("notes/todo.txt")).toBe("notes/todo.txt");
  });
});

describe("a name the disk already holds", () => {
  // é spelled both ways: a Mac's filesystem holds either as one file
  const composed = "Café.md";
  const decomposed = "Café.md";

  it("is one key in either case and either normalization", () => {
    expect(pathCollisionKey(decomposed)).toBe(pathCollisionKey(composed.toUpperCase()));
    expect(pathCollisionKey("Cafe.md")).not.toBe(pathCollisionKey(composed));
  });
});
