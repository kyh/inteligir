import { describe, expect, it } from "vitest";

import {
  bytesFolderPath,
  COVERS_DIR,
  fileKindOf,
  isBytesFolderPath,
  isItemKind,
  ITEM_KINDS,
  keptFileType,
  mediaTypeOfName,
  UNKNOWN_FILE_TYPE,
  URL_ITEM_KINDS,
  WEB_URL_RULE,
} from "./item-kind";

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
    [".obsidian/app.json", null],
    ["folder/.DS_Store", null],
  ])("%s is %s", (path, expected) => {
    expect(fileKindOf(path)).toBe(expected);
  });

  it("keeps a file as the type it came with, or as plain bytes when that is none", () => {
    expect(keptFileType("image/png")).toBe("image/png");
    expect(keptFileType("")).toBe(UNKNOWN_FILE_TYPE);
    expect(UNKNOWN_FILE_TYPE).toBe("application/octet-stream");
  });

  it("reads a type from every extension it goes by", () => {
    expect(["a.ogg", "b.OGA", "c.opus"].map(mediaTypeOfName)).toStrictEqual([
      "audio/ogg",
      "audio/ogg",
      "audio/ogg",
    ]);
    expect(mediaTypeOfName("no-extension")).toBeNull();
  });

  it("spells the library's own places", () => {
    expect(COVERS_DIR).toBe("assets/covers");
  });

  it("writes a file in a folder of its bytes that an import reads as that file", () => {
    const path = bytesFolderPath("0123456789abcdef".repeat(4), "Report 2026.pdf");
    expect(path).toBe("assets/0123456789abcdef/Report 2026.pdf");
    expect(isBytesFolderPath(path)).toBe(true);
  });
});

describe("the web rule", () => {
  it("says the web rule", () => {
    expect(WEB_URL_RULE).toBe("Only web links (http or https) can be saved.");
  });
});
