import type { Nodes } from "mdast";
import { describe, expect, it } from "vitest";

import { parseBare } from "../bare-parse";
import { parseMdast } from "../parse";

const nodeText = (source: string, root: Nodes, type: Nodes["type"]): string[] => {
  const out: string[] = [];
  const walk = (node: Nodes): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === type && start !== undefined && end !== undefined) {
      out.push(source.slice(start, end));
    }
    if ("children" in node) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  walk(root);
  return out;
};

describe("a parse's offsets index the string it was handed, past a leading BOM", () => {
  it.each([
    ["no BOM", ""],
    ["a BOM", "\uFEFF"],
  ])("%s: the bare parse", (_, bom) => {
    const src = `${bom}[[old]] then [x](y.md)\r\n\r\n# Head\r\n`;
    const root = parseBare(src);
    expect(nodeText(src, root, "wikiLink")).toEqual(["[[old]]"]);
    expect(nodeText(src, root, "link")).toEqual(["[x](y.md)"]);
    expect(nodeText(src, root, "heading")).toEqual(["# Head"]);
  });

  it.each([
    ["no BOM", ""],
    ["a BOM", "\uFEFF"],
  ])("%s: the bare parse's math and jsx, attributes included", (_, bom) => {
    const src = `${bom}$$[[old]]$$ and <Card title="[[old]]" />\n`;
    const root = parseBare(src);
    expect(nodeText(src, root, "inlineMath")).toEqual(["$$[[old]]$$"]);
    expect(nodeText(src, root, "mdxJsxTextElement")).toEqual(['<Card title="[[old]]" />']);
    const [paragraph] = root.children;
    const card = paragraph?.type === "paragraph" ? paragraph.children.at(-1) : undefined;
    const attribute = card?.type === "mdxJsxTextElement" ? card.attributes[0] : undefined;
    const start = attribute?.position?.start.offset;
    const end = attribute?.position?.end.offset;
    expect(src.slice(start, end)).toBe('title="[[old]]"');
  });

  it.each([
    ["no BOM", ""],
    ["a BOM", "\uFEFF"],
  ])("%s: the editor's parse", (_, bom) => {
    const parsed = parseMdast(`${bom}$$\nx\n$$\n`);
    expect(nodeText(parsed.text, parsed.root, "math")).toEqual(["$$\nx\n$$"]);
  });
});
