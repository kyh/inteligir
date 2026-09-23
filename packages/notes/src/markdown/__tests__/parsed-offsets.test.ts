import type { Nodes } from "mdast";
import { describe, expect, it } from "vitest";

import { parseMdast } from "../parse";
import { parseScan } from "../scan-parse";
import { literalRanges, verbatimSpans } from "../verbatim-spans";
import type { VerbatimSpan } from "../verbatim-spans";

const cut = (source: string, spans: readonly VerbatimSpan[] | null): string[] =>
  (spans ?? []).map((span) => source.slice(span.start, span.end));

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
  ])("%s: the scan", (_, bom) => {
    const src = `${bom}[[old]] then [x](y.md)\r\n\r\n# Head\r\n`;
    const root = parseScan(src);
    expect(nodeText(src, root, "wikiLink")).toEqual(["[[old]]"]);
    expect(nodeText(src, root, "link")).toEqual(["[x](y.md)"]);
    expect(nodeText(src, root, "heading")).toEqual(["# Head"]);
  });

  it.each([
    ["no BOM", ""],
    ["a BOM", "\uFEFF"],
  ])("%s: the editor's verbatim and literal ranges, jsx attributes included", (_, bom) => {
    const src = `${bom}$$[[old]]$$ and <Card title="[[old]]" />\n`;
    expect(cut(src, verbatimSpans(src))).toEqual(["$$[[old]]$$", '<Card title="[[old]]" />']);
    expect(cut(src, literalRanges(src))).toEqual(["$$[[old]]$$", 'title="[[old]]"']);
  });

  it.each([
    ["no BOM", ""],
    ["a BOM", "\uFEFF"],
  ])("%s: the editor's parse", (_, bom) => {
    const parsed = parseMdast(`${bom}$$\nx\n$$\n`);
    if (!parsed.ok) {
      throw new Error(parsed.failure.message);
    }
    expect(nodeText(parsed.text, parsed.root, "math")).toEqual(["$$\nx\n$$"]);
  });
});
