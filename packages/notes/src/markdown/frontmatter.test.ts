import { describe, expect, it } from "vitest";

import {
  frontmatterYaml,
  splitFrontmatter,
  yamlScalarText,
} from "@repo/notes/markdown/frontmatter";

import { parseBare } from "./bare-parse";

const NOTE_HEADERS = {
  "a BOM": "\uFEFF---\ntitle: t\n---\nbody\n",
  "a BOM and CRLF": "\uFEFF---\r\ntitle: t\r\n---\r\nbody\r\nmore\r\n",
  CRLF: "---\r\ntitle: t\r\ntags:\r\n  - a\r\n---\r\nbody\r\n",
  "an empty block": "---\n---\nbody\n",
  "no block": "body\n",
  "trailing-space fences": "---  \ntitle: t\n---\t\nbody\n",
} satisfies Record<string, string>;

describe("the frontmatter block is the one the scan reads", () => {
  it.each(Object.entries(NOTE_HEADERS))("%s: its yaml is the scan's yaml node", (_, src) => {
    const [first] = parseBare(src).children;
    expect(frontmatterYaml(src)).toBe(first?.type === "yaml" ? first.value : null);
  });
});

describe("splitFrontmatter", () => {
  it("returns the whole text as the body when there is no frontmatter", () => {
    const text = "# Hello\n\nbody text\n";
    expect(splitFrontmatter(text)).toEqual({ body: text });
  });

  it("cuts a leading yaml block and keeps the body verbatim", () => {
    const text = "---\ntitle: Note\ntags:\n  - a\n  - b\n---\n# Body\n\ntext\n";
    expect(splitFrontmatter(text)).toEqual({ body: "# Body\n\ntext\n" });
  });

  it("does not treat a mid-document --- as frontmatter", () => {
    const text = "para\n\n---\n\nmore\n";
    expect(splitFrontmatter(text).body).toBe(text);
  });

  it("cuts an empty block", () => {
    expect(splitFrontmatter("---\n---\nbody\n").body).toBe("body\n");
  });

  it("cuts a block that is not a mapping without reading it", () => {
    expect(splitFrontmatter("---\n- just\n- a list\n---\nbody\n").body).toBe("body\n");
  });
});

describe("yamlScalarText", () => {
  it("keeps a comma plain in a block value and quotes it in a flow list", () => {
    expect(yamlScalarText("a, b", "plain", "block")).toBe("a, b");
    expect(yamlScalarText("a, b", "plain")).toBe('"a, b"');
    expect(yamlScalarText("a: b", "plain", "block")).toBe('"a: b"');
    expect(yamlScalarText("[x]", "plain", "block")).toBe('"[x]"');
  });
});
