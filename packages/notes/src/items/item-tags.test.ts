import { describe, expect, it } from "vitest";

import { addFrontmatterTags, removeFrontmatterTags } from "./item-tags";

describe("addFrontmatterTags", () => {
  it.each([
    ["body\n", ["a"], "---\ntags:\n  - a\n---\n\nbody\n"],
    ["body\r\n", ["a"], "---\r\ntags:\r\n  - a\r\n---\r\n\r\nbody\r\n"],
    ["", ["a"], "---\ntags:\n  - a\n---\n"],
    ["---\nid: x\n---\n", ["a", "b"], "---\nid: x\ntags:\n  - a\n  - b\n---\n"],
    [
      "---\ntags:\n    - a\nother: 1\n---\n",
      ["b"],
      "---\ntags:\n    - a\n    - b\nother: 1\n---\n",
    ],
    [
      "---\ntags:\n- a # mine\nother: 1\n---\n",
      ["b"],
      "---\ntags:\n- a # mine\n- b\nother: 1\n---\n",
    ],
    ["---\ntags: [a,  b]\n---\n", ["c"], "---\ntags: [a,  b, c]\n---\n"],
    ["---\ntags: []\n---\n", ["c", "d"], "---\ntags: [c, d]\n---\n"],
    ["---\ntags: a\nid: x\n---\n", ["b"], "---\ntags:\n  - a\n  - b\nid: x\n---\n"],
    ["---\ntags: '#a'\n---\n", ["b"], "---\ntags:\n  - '#a'\n  - b\n---\n"],
    ["---\ntags:\n---\n", ["b"], "---\ntags:\n  - b\n---\n"],
    [
      "---\r\ntags:\r\n  - a\r\n---\r\nx\r\n",
      ["b"],
      "---\r\ntags:\r\n  - a\r\n  - b\r\n---\r\nx\r\n",
    ],
  ])("%j + %j", (content, tags, expected) => {
    expect(addFrontmatterTags(content, tags)).toBe(expected);
  });

  it("leaves the content as it was when every tag is there, in any case or with a #", () => {
    const content = "---\ntags: [Reading, '#later']\n---\n";
    expect(addFrontmatterTags(content, ["reading", "Later"])).toBe(content);
  });

  it("adds a tag once when asked for it twice", () => {
    expect(addFrontmatterTags("x", ["a", "A"])).toBe("---\ntags:\n  - a\n---\n\nx");
  });

  it("refuses an invalid block and a tags value that is not a list", () => {
    expect(addFrontmatterTags("---\nkey: [unclosed\n---\n", ["a"])).toBeNull();
    expect(addFrontmatterTags("---\ntags: 5\n---\n", ["a"])).toBeNull();
    expect(addFrontmatterTags("---\ntags:\n  a: 1\n---\n", ["a"])).toBeNull();
  });
});

describe("removeFrontmatterTags", () => {
  it.each([
    ["---\ntags:\n  - a\n  - b\n  - c\n---\n", ["b"], "---\ntags:\n  - a\n  - c\n---\n"],
    ["---\ntags:\n  - a # one\n  - b\nid: x\n---\n", ["A"], "---\ntags:\n  - b\nid: x\n---\n"],
    ["---\ntags: [a, b, c]\n---\n", ["a"], "---\ntags: [b, c]\n---\n"],
    ["---\ntags: [a, b, c]\n---\n", ["b"], "---\ntags: [a, c]\n---\n"],
    ["---\ntags: [a, b, c]\n---\n", ["c"], "---\ntags: [a, b]\n---\n"],
    ["---\ntags: [a, b, c]\n---\n", ["b", "c"], "---\ntags: [a]\n---\n"],
    ["---\ntags: [a, '#b', 5]\n---\n", ["b"], "---\ntags: [a, 5]\n---\n"],
    ["---\nid: x\ntags: [a, b]\n---\n", ["a", "b"], "---\nid: x\n---\n"],
    ["---\ntags:\n  - a\n---\nbody\n", ["a"], "body\n"],
    ["---\ntags:\n  - a\n---\n\nbody\n", ["a"], "body\n"],
    ["---\ntags: a\nid: x\n---\n", ["a"], "---\nid: x\n---\n"],
    ["---\r\ntags:\r\n  - a\r\n  - b\r\n---\r\n", ["a"], "---\r\ntags:\r\n  - b\r\n---\r\n"],
  ])("%j − %j", (content, tags, expected) => {
    expect(removeFrontmatterTags(content, tags)).toEqual({ content: expected, inline: [] });
  });

  it("leaves the content as it was when no entry names a tag", () => {
    const content = "---\ntags: [a]\n---\n";
    expect(removeFrontmatterTags(content, ["b"]).content).toBe(content);
    expect(removeFrontmatterTags("plain", ["b"]).content).toBe("plain");
  });

  it("names the tags a note still writes in its text, and none for a saved page", () => {
    expect(removeFrontmatterTags("---\ntags: [a, b]\n---\nSee #a here.\n", ["a", "b"])).toEqual({
      content: "See #a here.\n",
      inline: ["a"],
    });
    expect(removeFrontmatterTags("---\nkind: link\ntags: [a]\n---\nSee #a here.\n", ["a"])).toEqual(
      { content: "---\nkind: link\n---\nSee #a here.\n", inline: [] },
    );
  });

  it("refuses an invalid block", () => {
    expect(removeFrontmatterTags("---\nkey: [unclosed\n---\n", ["a"])).toEqual({
      content: null,
      inline: [],
    });
  });
});
