import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOC_EXTENSION,
  docExtension,
  docStem,
  isDocPath,
  isVaultMetadataPath,
} from "../knowledge/doc-file";

describe("what counts as a doc", () => {
  it("names every extension the index and the listing carry", () => {
    for (const path of ["a.md", "a.markdown", "a.mdx", "a.txt", "notes/README.TXT"]) {
      expect(isDocPath(path)).toBe(true);
    }
    for (const path of ["a.png", "a", "assets/logo.svg", ".gitignore"]) {
      expect(isDocPath(path)).toBe(false);
    }
  });

  it("mints new docs with the default extension", () => {
    expect(isDocPath(`Untitled${DEFAULT_DOC_EXTENSION}`)).toBe(true);
  });
});

describe("what a listing hides", () => {
  it("hides the comment sidecar and every dot-entry, at any depth", () => {
    for (const path of [
      "Welcome.md.comments.json",
      "notes/a.md.comments.json",
      ".obsidian/app.json",
      "notes/.DS_Store",
      ".trash",
    ]) {
      expect(isVaultMetadataPath(path)).toBe(true);
    }
  });

  it("shows notes, folders and attachments", () => {
    for (const path of ["Welcome.md", "notes", "notes/comments.json", "assets/logo.png"]) {
      expect(isVaultMetadataPath(path)).toBe(false);
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
