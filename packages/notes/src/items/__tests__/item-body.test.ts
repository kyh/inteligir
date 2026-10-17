import { describe, expect, it } from "vitest";

import { bodyOf, composeLinkBody, embedMarkdown, linkMarkdown, withBody } from "../item-body";

describe("embeds and links, spelled as the editor writes them", () => {
  it.each([
    ["assets/x.png", "![](assets/x.png)"],
    ["assets/covers/3f9a0c2b1d4e5f60.jpg", "![](assets/covers/3f9a0c2b1d4e5f60.jpg)"],
    ["assets/Lecture notes.pdf", "![](<assets/Lecture notes.pdf>)"],
    ["assets/a_b-c.zip", "![](assets/a_b-c.zip)"],
  ])("%s", (path, expected) => {
    expect(embedMarkdown(path)).toBe(expected);
  });

  it("links the page copy", () => {
    expect(linkMarkdown("Copy of the page", "assets/pages/0a1b.html")).toBe(
      "[Copy of the page](assets/pages/0a1b.html)",
    );
  });
});

describe("bodyOf and withBody", () => {
  it.each([
    ["---\nid: x\n---\nhi\n", "hi\n"],
    ["---\nid: x\n---\n", ""],
    ["---\nid: x\n---", ""],
    ["plain\n", "plain\n"],
    ["﻿plain", "plain"],
    ["﻿---\r\nid: x\r\n---\r\nbody\r\n", "body\r\n"],
  ])("bodyOf(%j)", (content, expected) => {
    expect(bodyOf(content)).toBe(expected);
  });

  it.each([
    ["---\nid: x\n---\nold\n", "new\n", "---\nid: x\n---\nnew\n"],
    ["---\nid: x\n---\nold\n", "", "---\nid: x\n---\n"],
    ["---\nid: x\n---", "new\n", "---\nid: x\n---\nnew\n"],
    ["old", "new", "new"],
    ["﻿old", "new", "﻿new"],
    ["﻿---\r\nid: x\r\n---\r\nold\r\n", "new\r\n", "﻿---\r\nid: x\r\n---\r\nnew\r\n"],
  ])("withBody(%j, %j)", (content, body, expected) => {
    expect(withBody(content, body)).toBe(expected);
  });
});

describe("composeLinkBody", () => {
  it("puts the cover, the note, the article and the copy a paragraph apart", () => {
    expect(
      composeLinkBody({
        article: "File over app is a philosophy: …\n\n",
        copy: "assets/pages/aa.html",
        cover: "assets/covers/3f9a0c2b1d4e5f60.jpg",
        note: "\nFor Tuesday.\n",
      }),
    ).toBe(
      "![](assets/covers/3f9a0c2b1d4e5f60.jpg)\n\nFor Tuesday.\n\nFile over app is a philosophy: …\n\n[Copy of the page](assets/pages/aa.html)\n",
    );
  });

  it("skips the empty parts and is empty when they all are", () => {
    expect(composeLinkBody({ article: "", copy: null, cover: null, note: "For Tuesday." })).toBe(
      "For Tuesday.\n",
    );
    expect(composeLinkBody({ article: "  \n", copy: null, cover: null, note: "" })).toBe("");
  });
});
