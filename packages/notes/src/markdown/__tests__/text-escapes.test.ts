import type { Nodes, Paragraph, Root } from "mdast";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { MD_REMARK_PLUGINS, MD_STRINGIFY } from "../md-plugins";
import { parseMdast } from "../parse";

const processor = unified()
  .use(remarkParse)
  .use(MD_REMARK_PLUGINS)
  .use(remarkStringify, MD_STRINGIFY)
  .freeze();

const stringify = (root: Root): string => processor.stringify(root);

// a node and every node under it in document order, indented by depth, each text with its value
const outline = (node: Nodes, depth = 0): string[] => {
  const own = `${"  ".repeat(depth)}${node.type === "text" ? `text ${node.value}` : node.type}`;
  return "children" in node
    ? [own, ...node.children.flatMap((child) => outline(child, depth + 1))]
    : [own];
};

const outlineOf = (md: string): string[] => outline(parseMdast(md).root).slice(1);

const paragraph = (value: string): Paragraph => ({
  children: [{ type: "text", value }],
  type: "paragraph",
});

describe("a construct whose first character an escape wrote", () => {
  it.each([
    ["a date chip", "Meet \\@2026-07-01 there\n", "text Meet @2026-07-01 there"],
    ["a formula pill", "Sum \\{{a|b}} here\n", "text Sum {{a|b}} here"],
    ["an annotation marker", "See \\%%i:c1:start%% here\n", "text See %%i:c1:start%% here"],
  ])("is text: %s", (_name, md, text) => {
    expect(outlineOf(md)).toEqual(["  paragraph", `    ${text}`]);
    expect(stringify(parseMdast(md).root)).toBe(md);
  });

  it("is text: a `:::` line inside a toggle, which would close it", () => {
    const md = ":::toggle\nsummary\n\n\\:::\n\nafter\n:::\n";
    expect(outlineOf(md)).toEqual([
      "  toggle",
      "    paragraph",
      "      text summary",
      "    paragraph",
      "      text :::",
      "    paragraph",
      "      text after",
    ]);
    expect(stringify(parseMdast(md).root)).toBe(md);
  });

  it("is text: a `=== Label` line inside tabs, which would open a panel", () => {
    const md = ":::tabs\n=== One\n\\=== Two\n:::\n";
    expect(outlineOf(md)).toEqual([
      "  tabGroup",
      "    tabPanel",
      "      paragraph",
      "        text === Two",
    ]);
    expect(stringify(parseMdast(md).root)).toBe(md);
  });

  it("is still a construct when only a later character is escaped", () => {
    expect(outlineOf("| a |\n| - |\n| {{x\\|y}} |\n")).toContain("        formulaPill");
  });

  it("is text after a construct read earlier from the same text", () => {
    expect(outlineOf(":::toggle\n{{a}} and\n\\:::\n:::\n")).toEqual([
      "  toggle",
      "    paragraph",
      "      formulaPill",
      "      text  and\n:::",
    ]);
  });
});

describe("a text the next parse would read as a construct", () => {
  it.each([
    ["Meet @2026-07-01 there", "Meet \\@2026-07-01 there\n"],
    ["Sum {{a|b}} here", "Sum \\{{a|b}} here\n"],
    ["See %%i:c1:start%% here", "See \\%%i:c1:start%% here\n"],
  ])("is written escaped: %j", (value, md) => {
    expect(stringify({ children: [paragraph(value)], type: "root" })).toBe(md);
  });

  it.each([":::", ":::toggle", ":::tabs", ":::columns", ":::column", ":::column 50%"])(
    "is written escaped: a %j line in a toggle",
    (line) => {
      const root: Root = {
        children: [{ children: [paragraph("summary"), paragraph(line)], type: "toggle" }],
        type: "root",
      };
      const md = stringify(root);
      expect(md).toBe(`:::toggle\nsummary\n\n\\${line}\n:::\n`);
      expect(outlineOf(md)).toEqual([
        "  toggle",
        "    paragraph",
        "      text summary",
        "    paragraph",
        `      text ${line}`,
      ]);
    },
  );

  it.each([
    ["a day no calendar has", "due @2026-02-30"],
    ["a date in a link's text", "see [@2026-07-01](x.md)"],
    ["a brace pair holding no pill", "a {{}} b"],
    ["a line that only starts like a marker", ":::note"],
  ])("is left as written: %s", (_name, value) => {
    const md = `${value}\n`;
    expect(stringify(parseMdast(md).root)).toBe(md);
  });
});
