import { describe, expect, it } from "vitest";

import { frontmatterYaml, yamlScalarText } from "@repo/editor/markdown/frontmatter";

import { mdastOf } from "../test-support/mdast-of";

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
    const [first] = mdastOf(src).children;
    expect(frontmatterYaml(src)).toBe(first?.type === "yaml" ? first.value : null);
  });
});

describe(yamlScalarText, () => {
  it("stays plain while it reads back as itself, and quotes otherwise", () => {
    expect(yamlScalarText("a, b")).toBe("a, b");
    expect(yamlScalarText("a: b")).toBe('"a: b"');
    expect(yamlScalarText("[x]")).toBe('"[x]"');
  });
});
