import type { Nodes, Root } from "mdast";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseBare } from "../bare-parse";
import { parseMdast } from "../parse";

// [type, value] for each node of the first block, html and text by value
const inline = (root: Root): [string, string][] => {
  const [block] = root.children;
  if (block === undefined || !("children" in block)) {
    return [];
  }
  const children: Nodes[] = block.children;
  return children.map((child) => [child.type, "value" in child ? child.value : ""]);
};

describe("a tag that cannot pair is kept as its own bytes", () => {
  it.each([
    [
      "a closer with no opener",
      "text </Bar> more\n",
      [
        ["text", "text "],
        ["html", "</Bar>"],
        ["text", " more"],
      ],
    ],
    [
      "a mismatched closer",
      "<Foo>broken</Bar>\n",
      [
        ["html", "<Foo>"],
        ["text", "broken"],
        ["html", "</Bar>"],
      ],
    ],
    [
      "an opener its paragraph never closes",
      "a <br> b\n",
      [
        ["text", "a "],
        ["html", "<br>"],
        ["text", " b"],
      ],
    ],
    [
      "a closer that would end a span it sits inside",
      "<b>*a</b>*\n",
      [
        ["html", "<b>"],
        ["emphasis", ""],
      ],
    ],
  ])("%s", (_name, md, expected) => {
    expect(inline(parseBare(md))).toEqual(expected);
  });

  it("pairs nothing across a blank line: each paragraph keeps its own tag", () => {
    const root = parseBare("<Foo>\n\nnever closed\n\n</Foo>\n");
    expect(root.children.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(inline(root)).toEqual([["html", "<Foo>"]]);
  });

  it.each([
    ["a label", "[a <br> b](x)\n"],
    ["an atx heading", "# a <br> b #\n"],
    ["a setext heading", "a <br> b\n===\n"],
  ])("keeps an opener %s never closes as html", (_name, md) => {
    const [block] = parseBare(md).children;
    expect(JSON.stringify(block)).toContain('"value":"<br>"');
    expect(JSON.stringify(block)).not.toContain("htmlElement");
  });
});

describe("a tag and its closer fold into one node", () => {
  it.each([
    ["a bare <u>, as the underline mark", "a <u>key</u> b\n", "underline"],
    ["any other tag, as an element", "a <kbd>K</kbd> b\n", "htmlElement"],
    ["a <u> with attributes, as an element", 'a <u class="x">key</u> b\n', "htmlElement"],
    [
      "a block-level name, which flow html cannot claim",
      '<div align="center">x</div>\n',
      "htmlElement",
    ],
  ])("%s", (_name, md, type) => {
    expect(inline(parseBare(md)).map(([kind]) => kind)).toContain(type);
  });

  it("pairs a closer with the innermost opener of its name, passing others over as html", () => {
    const [block] = parseBare("<a><b>x</a> and <u><kbd>K</kbd></u>\n").children;
    expect(block?.type).toBe("paragraph");
    const children = block?.type === "paragraph" ? block.children : [];
    const [outer, , underline] = children;
    expect(outer?.type).toBe("htmlElement");
    expect(outer?.type === "htmlElement" ? outer.children.map((child) => child.type) : []).toEqual([
      "html",
      "text",
    ]);
    expect(underline?.type).toBe("underline");
    expect(
      underline?.type === "underline" ? underline.children.map((child) => child.type) : [],
    ).toEqual(["htmlElement"]);
  });

  it("spans an element from its opener to its closer", () => {
    const src = "see <kbd>K\nL</kbd> here\n";
    const [block] = parseBare(src).children;
    const element = block?.type === "paragraph" ? block.children[1] : undefined;
    const start = element?.position?.start.offset;
    const end = element?.position?.end.offset;
    expect(src.slice(start, end)).toBe("<kbd>K\nL</kbd>");
  });
});

describe("`<` that opens no tag reads as what else reads it", () => {
  it.each([
    ["an autolink", "<https://x.y>\n", "link"],
    ["an email autolink", "<a@b.com>\n", "link"],
    ["an html comment", "<!-- c -->\n", "html"],
    ["text, past an unclosed tag", "an unclosed <Foo\n", "text"],
    ["text, past attributes on a closer", "</Foo bar>\n", "text"],
    ["text, past a braced attribute", "<Foo bar={x\n", "text"],
  ])("%s", (_name, md, type) => {
    expect(inline(parseBare(md)).map(([kind]) => kind)).toContain(type);
  });

  it("reads `{` as prose: there are no expressions", () => {
    expect(inline(parseBare("the JSON opens with {\n"))).toEqual([
      ["text", "the JSON opens with {"],
    ]);
  });
});

const PIECES = [
  "<",
  ">",
  "/",
  "{",
  "}",
  "a",
  " ",
  "\n",
  "\n\n",
  "> ",
  "- ",
  "  ",
  "=",
  '"',
  "*",
  "[",
  "](x)",
  "# ",
  "\n===",
  "<a>",
  "</a>",
  "<b c='d'>",
  "</b>",
  "<>",
  "</>",
  "<br>",
  "<u>",
  "</u>",
  "<x/>",
  "<y {...p}>",
  "<z w={1}>",
  ":::toggle\n",
  ":::tabs\n",
  "=== A\n",
  ":::columns\n",
  ":::column\n",
  ":::\n",
  "$$",
  "{{1|2}}",
  "[[x]]",
  "`",
];

// Park-Miller over a fixed seed, so a failure names the same document on every run
const MODULUS = 2_147_483_647;

const random = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 48_271) % MODULUS;
    return state / MODULUS;
  };
};

// a node the compiler entered and never exited has no end
const closedPosition = z.object({ end: z.object({ offset: z.number() }) });

const unclosed = (node: Nodes): string | null => {
  if (node.position !== undefined && !closedPosition.safeParse(node.position).success) {
    return node.type;
  }
  if ("children" in node) {
    for (const child of node.children) {
      const found = unclosed(child);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
};

describe("the grammar is total", () => {
  it("parses every document built from tag fragments, closing every node it opens", () => {
    const draw = random(42);
    for (let doc = 0; doc < 2000; doc += 1) {
      let md = "";
      for (let piece = Math.floor(draw() * 24); piece >= 0; piece -= 1) {
        md += PIECES[Math.floor(draw() * PIECES.length)] ?? "";
      }
      expect(unclosed(parseBare(md)), md).toBeNull();
      expect(unclosed(parseMdast(md).root), md).toBeNull();
    }
  });
});
