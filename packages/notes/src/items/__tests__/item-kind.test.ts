import { describe, expect, it } from "vitest";

import {
  COVERS_DIR,
  FILE_KIND_EXTENSIONS,
  fileKindOf,
  fileTooLargeMessage,
  isItemKind,
  ITEM_FILE_MAX_BYTES,
  ITEM_KINDS,
  LIBRARY_RULES_PATH,
  PAGES_DIR,
  UNSORTED_FOLDER,
  URL_ITEM_KINDS,
  WEB_URL_RULE,
} from "../item-kind";

describe("item kinds", () => {
  it("names every kind once, the url kinds among them", () => {
    expect(new Set(ITEM_KINDS).size).toBe(ITEM_KINDS.length);
    for (const kind of URL_ITEM_KINDS) {
      expect(isItemKind(kind)).toBe(true);
    }
    expect(isItemKind("bookmark")).toBe(false);
    expect(isItemKind("Link")).toBe(false);
  });

  it.each([
    ["assets/IMG_2041.PNG", "image"],
    ["photo.heic", "image"],
    ["Lecture notes.pdf", "pdf"],
    ["clip.MOV", "video"],
    ["song.mp3", "audio"],
    ["archive.zip", "file"],
    ["Makefile", "file"],
    ["note.md", null],
    ["todo.txt", null],
    [".inteligir/annotations/x.json", null],
    ["folder/.DS_Store", null],
  ])("%s is %s", (path, expected) => {
    expect(fileKindOf(path)).toBe(expected);
  });

  it("lists each extension under one kind", () => {
    const all = Object.values(FILE_KIND_EXTENSIONS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("spells the library's own places", () => {
    expect([UNSORTED_FOLDER, COVERS_DIR, PAGES_DIR, LIBRARY_RULES_PATH]).toEqual([
      "Unsorted",
      "assets/covers",
      "assets/pages",
      "AGENTS.md",
    ]);
  });
});

describe("the refusal sentences", () => {
  it("says the web rule", () => {
    expect(WEB_URL_RULE).toBe("Only web links (http or https) can be saved.");
  });

  it.each([
    [24 * 1024 * 1024, "“Big.mov” is 24 MB. inteligir keeps files up to 10 MB."],
    [ITEM_FILE_MAX_BYTES + 1, "“Big.mov” is 10 MB. inteligir keeps files up to 10 MB."],
    [10.6 * 1024 * 1024, "“Big.mov” is 11 MB. inteligir keeps files up to 10 MB."],
    [1024, "“Big.mov” is 1 MB. inteligir keeps files up to 10 MB."],
  ])("%d bytes", (bytes, expected) => {
    expect(fileTooLargeMessage("Big.mov", bytes)).toBe(expected);
  });
});
