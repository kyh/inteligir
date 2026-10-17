import { ITEM_FILE_MAX_BYTES, fileKindOf } from "@repo/notes/items/item-kind";
import { describe, expect, it } from "vitest";
import {
  assetKind,
  VAULT_ASSET_MAX_BYTES,
  VAULT_ASSET_MEDIA_TYPES,
} from "../../../cloud/vault/vault-schema";
import { CAPTURE_HTML_MAX_CHARS } from "../../../browser/browser-wire";
import {
  capturedPageSchema,
  ITEM_TAGS_MAX,
  itemsSaveFileRequestSchema,
  itemsSaveLinkRequestSchema,
  itemsTagRequestSchema,
  WEB_URL_RULE,
  webUrlSchema,
} from "../items-schema";

describe("a saved link's address", () => {
  it("is a web link, trimmed", () => {
    expect(webUrlSchema.parse("  https://stephango.com/file-over-app ")).toBe(
      "https://stephango.com/file-over-app",
    );
  });

  it.each([
    "ftp://example.com/",
    "mailto:a@example.com",
    "file:///etc/passwd",
    "stephango.com",
    "",
  ])("refuses %j in the words every client says", (url) => {
    const parsed = webUrlSchema.safeParse(url);
    expect(parsed.success).toBe(false);
    if (!parsed.success && url !== "") {
      expect(parsed.error.issues[0]?.message).toBe(WEB_URL_RULE);
    }
  });
});

describe("a save's request", () => {
  it("defaults to no copy of the page and an answer before the fill", () => {
    expect(itemsSaveLinkRequestSchema.parse({ url: "https://example.com/" })).toEqual({
      keepCopy: false,
      url: "https://example.com/",
      wait: false,
    });
  });

  it("takes at most ITEM_TAGS_MAX tags, each a tag name", () => {
    const tags = Array.from({ length: ITEM_TAGS_MAX }, (_, n) => `t${String(n)}`);
    const url = "https://example.com/";
    expect(itemsSaveLinkRequestSchema.safeParse({ tags, url }).success).toBe(true);
    expect(itemsSaveLinkRequestSchema.safeParse({ tags: [...tags, "one"], url }).success).toBe(
      false,
    );
    expect(itemsSaveLinkRequestSchema.safeParse({ tags: ["not a tag"], url }).success).toBe(false);
  });

  it("takes a captured page's html up to the browser wire's cap", () => {
    const page = { html: "x", selection: null, title: "T", url: "https://example.com/" };
    expect(capturedPageSchema.safeParse(page).success).toBe(true);
    expect(
      capturedPageSchema.safeParse({ ...page, html: "x".repeat(CAPTURE_HTML_MAX_CHARS + 1) })
        .success,
    ).toBe(false);
  });

  it("refuses a file that holds no bytes", () => {
    expect(
      itemsSaveFileRequestSchema.safeParse({ file: new Blob([]), name: "a.png" }).success,
    ).toBe(false);
    expect(
      itemsSaveFileRequestSchema.safeParse({ file: new Blob(["x"]), name: "a.png" }).success,
    ).toBe(true);
  });
});

describe("a tag edit", () => {
  const paths = ["Unsorted/a.md"];

  it("names a tag to add or to remove", () => {
    expect(itemsTagRequestSchema.safeParse({ paths }).success).toBe(false);
    expect(itemsTagRequestSchema.parse({ add: ["design"], paths })).toEqual({
      add: ["design"],
      paths,
      remove: [],
    });
  });

  it("refuses a tag both added and removed, in any case, and a path named twice", () => {
    expect(
      itemsTagRequestSchema.safeParse({ add: ["Design"], paths, remove: ["design"] }).success,
    ).toBe(false);
    expect(
      itemsTagRequestSchema.safeParse({ add: ["design"], paths: [...paths, ...paths] }).success,
    ).toBe(false);
  });
});

describe("the files an item may be", () => {
  it("serves each media row as the kind fileKindOf gives its extension", () => {
    for (const [extension, row] of VAULT_ASSET_MEDIA_TYPES) {
      expect(fileKindOf(`assets/file${extension}`), extension).toBe(row.kind);
      expect(assetKind(`assets/FILE${extension.toUpperCase()}`), extension).toBe(row.kind);
    }
  });

  it("holds an item's original to the cap a stored file has", () => {
    expect(ITEM_FILE_MAX_BYTES).toBe(VAULT_ASSET_MAX_BYTES);
  });
});
