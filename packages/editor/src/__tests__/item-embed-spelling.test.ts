import { describe, expect, it } from "vitest";

import { analyzeMarkdown } from "@repo/editor/markdown/markdown-doc";
import { composeLinkBody, embedMarkdown } from "@repo/notes/items/item-body";
import { composeItemFile } from "@repo/notes/items/item-frontmatter";

// An item's writers (the save, the fill, the phone, the import) spell its cover, its original
// and its page copy through @repo/notes/items/item-body, and the editor must read every such file
// as its own fixpoint: an item opens rich, and its first edit is a minimal diff rather than a
// rewrite of what the fill wrote.

const ID = "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17";
const SAVED = "2026-10-17T09:12:30Z";
const FETCHED = "2026-10-17T09:12:33Z";
const URL_SAVED = "https://stephango.com/file-over-app";
const DESCRIPTION =
  "If you want to create digital artifacts that last, they must be files you can control, in formats that are easy to retrieve and read.";

// every way an item reads on disk (§1.4), with the one blank line the editor writes under the
// frontmatter block and every writer copies (composeItemFile, withBody)
const EXAMPLES = {
  "a failed fill": [
    "---",
    "id: 0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11",
    "kind: link",
    "url: http://localhost:3000/",
    `saved: ${SAVED}`,
    `fetched: ${SAVED}`,
    "fetch-error: This address is on this Mac, so its page isn't read.",
    "---",
    "",
  ].join("\n"),
  "a file item": [
    "---",
    `id: ${ID}`,
    "kind: file",
    `saved: ${SAVED}`,
    "---",
    "",
    "![](assets/archive.zip)",
    "",
  ].join("\n"),
  "a filled link": [
    "---",
    `id: ${ID}`,
    "kind: link",
    `url: ${URL_SAVED}`,
    "site: Steph Ango",
    "author: Steph Ango",
    "published: 2023-07-01",
    `saved: ${SAVED}`,
    `fetched: ${FETCHED}`,
    `description: ${DESCRIPTION}`,
    "---",
    "",
    "![](assets/covers/3f9a0c2b1d4e5f60.jpg)",
    "",
    "For Tuesday.",
    "",
    "File over app is a philosophy: if you want to create digital artifacts that last, they must be files you can control.",
    "",
  ].join("\n"),
  "a link stub from a paste": [
    "---",
    "id: 0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11",
    "kind: link",
    `url: ${URL_SAVED}`,
    `saved: ${SAVED}`,
    "---",
    "",
  ].join("\n"),
  "a link stub from a share, with a note": [
    "---",
    `id: ${ID}`,
    "kind: link",
    `url: ${URL_SAVED}`,
    `saved: ${SAVED}`,
    "---",
    "",
    "For Tuesday.",
    "",
  ].join("\n"),
  "a note the person made": ["---", `saved: ${SAVED}`, "---", ""].join("\n"),
  "a PDF item whose name has a space": [
    "---",
    `id: ${ID}`,
    "kind: pdf",
    `saved: ${SAVED}`,
    "---",
    "",
    "![](<assets/Lecture notes.pdf>)",
    "",
  ].join("\n"),
  "a video save": [
    "---",
    `id: ${ID}`,
    "kind: video",
    "url: https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "site: YouTube",
    "author: Rick Astley",
    `saved: ${SAVED}`,
    `fetched: ${FETCHED}`,
    "description: The official video for Never Gonna Give You Up.",
    "---",
    "",
    "![](assets/covers/9c1d4e5f60718293.jpg)",
    "",
    "The official video for Never Gonna Give You Up.",
    "",
  ].join("\n"),
  "an image item": [
    "---",
    `id: ${ID}`,
    "kind: image",
    `saved: ${SAVED}`,
    "---",
    "",
    "![](assets/IMG_2041.png)",
    "",
  ].join("\n"),
} satisfies Record<string, string>;

describe("an item as its writers spell it is the editor's own fixpoint", () => {
  for (const [example, bytes] of Object.entries(EXAMPLES)) {
    it(example, () => {
      expect(analyzeMarkdown(bytes)).toEqual({ kind: "canonical" });
    });
  }

  it("composes a filled link with every part: cover, note, article and page copy", () => {
    const body = composeLinkBody({
      article: "File over app is a philosophy.\n\n## Why files\n\nThey outlast the app.\n",
      copy: "assets/pages/0a1b2c3d4e5f6071.html",
      cover: "assets/covers/3f9a0c2b1d4e5f60.jpg",
      note: "For Tuesday.\n",
    });
    const file = composeItemFile(
      {
        author: "Steph Ango",
        description: DESCRIPTION,
        fetched: FETCHED,
        id: ID,
        kind: "link",
        saved: SAVED,
        site: "Steph Ango",
        tags: ["essay", "reading/later"],
        url: URL_SAVED,
      },
      body,
    );
    expect(file).toContain("[Copy of the page](assets/pages/0a1b2c3d4e5f6071.html)\n");
    expect(analyzeMarkdown(file)).toEqual({ kind: "canonical" });
  });

  it("composes a stub with no body, and a file wrapper whose original's name needs brackets", () => {
    const stub = composeItemFile({ id: ID, kind: "link", saved: SAVED, url: URL_SAVED }, "");
    expect(analyzeMarkdown(stub)).toEqual({ kind: "canonical" });

    const wrapper = composeItemFile(
      { id: ID, kind: "pdf", saved: SAVED },
      `${embedMarkdown("assets/Lecture notes (week 2).pdf")}\n`,
    );
    expect(analyzeMarkdown(wrapper)).toEqual({ kind: "canonical" });
  });
});
