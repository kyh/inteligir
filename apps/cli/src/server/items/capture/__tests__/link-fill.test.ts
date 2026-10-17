// what a fill writes into a link's file: the keys it owns and nothing else, the body in its order
// (cover, the person's note, the article, the copy's link), and the same bytes when it runs twice.

import { describe, expect, it } from "vitest";

import { FILL_OWNED_KEYS } from "@repo/notes/items/item-kind";

import { applyFillFailure, applyLinkFill, applyMediaFill } from "../link-fill";
import type { LinkFill } from "../link-fill";

const STUB = [
  "---",
  "id: 7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
  "kind: link",
  "url: https://stephango.com/file-over-app",
  "saved: 2026-10-17T09:12:30Z",
  "# a person's comment, kept",
  "rating: 5",
  "tags:",
  "  - essays",
  "---",
  "",
  "For Tuesday.",
  "",
].join("\n");

const FILL: LinkFill = {
  article: "File over app is a philosophy.\n",
  author: "Steph Ango",
  copy: "assets/pages/aaaaaaaaaaaaaaaa.html",
  cover: "assets/covers/3f9a0c2b1d4e5f60.jpg",
  description: "If you want to create digital artifacts that last, they must be files.",
  fetched: "2026-10-17T09:12:33Z",
  published: "2023-07-01",
  site: "Steph Ango",
};

const written = (content: string | null): string => {
  if (content === null) {
    throw new Error("the fill refused the file");
  }
  return content;
};

const keysOf = (content: string): string[] =>
  content
    .split("---")[1]
    ?.split("\n")
    .map((line) => /^(?<key>[\w-]+):/u.exec(line)?.groups?.key)
    .filter((key): key is string => key !== undefined) ?? [];

describe("applyLinkFill", () => {
  it("writes the keys a fill owns in compose order, and leaves every other byte of the block", () => {
    const filled = written(applyLinkFill(STUB, FILL));
    expect(filled.split("---\n\n")[0]).toBe(
      [
        "---",
        "id: 7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
        "kind: link",
        "url: https://stephango.com/file-over-app",
        "site: Steph Ango",
        "author: Steph Ango",
        "published: 2023-07-01",
        "saved: 2026-10-17T09:12:30Z",
        "fetched: 2026-10-17T09:12:33Z",
        "description: If you want to create digital artifacts that last, they must be files.",
        "# a person's comment, kept",
        "rating: 5",
        "tags:",
        "  - essays",
        "",
      ].join("\n"),
    );
    const added = keysOf(filled).filter((key) => !keysOf(STUB).includes(key));
    expect(added.every((key) => FILL_OWNED_KEYS.some((owned) => owned === key))).toBe(true);
  });

  it("never writes url or saved", () => {
    const filled = written(applyLinkFill(STUB, FILL));
    expect(filled).toContain("url: https://stephango.com/file-over-app\n");
    expect(filled).toContain("saved: 2026-10-17T09:12:30Z\n");
  });

  it("puts the cover first, the person's note next, then the article and the copy's link", () => {
    expect(written(applyLinkFill(STUB, FILL)).split("---\n\n")[1]).toBe(
      [
        "![](assets/covers/3f9a0c2b1d4e5f60.jpg)",
        "",
        "For Tuesday.",
        "",
        "File over app is a philosophy.",
        "",
        "[Copy of the page](assets/pages/aaaaaaaaaaaaaaaa.html)",
        "",
      ].join("\n"),
    );
  });

  it("writes the same bytes when it runs again", () => {
    const once = written(applyLinkFill(STUB, FILL));
    expect(applyLinkFill(once, FILL)).toBe(once);
  });

  it("adds no cover above a note that already opens with a picture", () => {
    const pictured = STUB.replace("For Tuesday.", "![](assets/mine.png)\n\nFor Tuesday.");
    const body = written(applyLinkFill(pictured, FILL)).split("---\n\n")[1] ?? "";
    expect(body.startsWith("![](assets/mine.png)\n\nFor Tuesday.\n\nFile over app")).toBe(true);
  });

  it("keeps a key the page did not give, an imported excerpt among them", () => {
    const imported = STUB.replace("saved:", "description: From Raindrop.\nsaved:");
    const filled = written(applyLinkFill(imported, { ...FILL, author: null, description: null }));
    expect(filled).toContain("description: From Raindrop.\n");
    expect(filled).not.toContain("author:");
  });

  it("on a filled item, moves only the cover and the copy, and keeps the text", () => {
    const once = written(applyLinkFill(STUB, FILL));
    const edited = once.replace("File over app is a philosophy.", "My own words now.");
    const refreshed = written(
      applyLinkFill(edited, {
        ...FILL,
        article: "A new article.\n",
        copy: "assets/pages/bbbbbbbbbbbbbbbb.html",
        cover: "assets/covers/ffffffffffffffff.png",
        fetched: "2026-10-18T10:00:00Z",
        site: "stephango.com",
      }),
    );
    expect(refreshed).toContain("site: stephango.com\n");
    expect(refreshed).toContain("fetched: 2026-10-18T10:00:00Z\n");
    expect(refreshed.split("---\n\n")[1]).toBe(
      [
        "![](assets/covers/ffffffffffffffff.png)",
        "",
        "For Tuesday.",
        "",
        "My own words now.",
        "",
        "[Copy of the page](assets/pages/bbbbbbbbbbbbbbbb.html)",
        "",
      ].join("\n"),
    );
  });

  it("rewrites the body from the page when asked to replace it", () => {
    const once = written(applyLinkFill(STUB, FILL));
    const replaced = written(
      applyLinkFill(once, { ...FILL, article: "Only this.\n", copy: null }, "replace"),
    );
    expect(replaced.split("---\n\n")[1]).toBe(
      "![](assets/covers/3f9a0c2b1d4e5f60.jpg)\n\nOnly this.\n",
    );
  });

  it("fills around the note again after a failed fill, removing the failure", () => {
    const failed = written(
      applyFillFailure(STUB, {
        cover: null,
        fetched: "2026-10-17T09:12:31Z",
        message: "The page couldn't be reached.",
      }),
    );
    const filled = written(applyLinkFill(failed, FILL));
    expect(filled).not.toContain("fetch-error");
    expect(filled).toContain("For Tuesday.\n\nFile over app is a philosophy.");
  });

  it("refuses a block that does not parse", () => {
    expect(applyLinkFill("---\nkind: [link\n---\nbody\n", FILL)).toBeNull();
  });
});

describe("applyFillFailure", () => {
  it("says why in fetch-error beside fetched, and puts a hint's cover first", () => {
    const failed = written(
      applyFillFailure(STUB, {
        cover: "assets/covers/1111111111111111.jpg",
        fetched: "2026-10-17T09:12:31Z",
        message: "The site answered 404 (not found).",
      }),
    );
    expect(failed).toContain(
      "fetched: 2026-10-17T09:12:31Z\nfetch-error: The site answered 404 (not found).\n",
    );
    expect(failed.split("---\n\n")[1]).toBe(
      "![](assets/covers/1111111111111111.jpg)\n\nFor Tuesday.\n",
    );
  });
});

describe("applyMediaFill", () => {
  it("makes the link the file's item, its original under the note", () => {
    const media = written(
      applyMediaFill(STUB, {
        fetched: "2026-10-17T09:12:31Z",
        kind: "pdf",
        original: "assets/Paper.pdf",
      }),
    );
    expect(media).toContain("kind: pdf\n");
    expect(media.split("---\n\n")[1]).toBe("For Tuesday.\n\n![](assets/Paper.pdf)\n");
  });
});
