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

  it("unwraps an opener the document never closes, keeping its children in place", () => {
    const root = parseBare("<Foo>\n\nnever closed\n");
    expect(root.children.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
    expect(inline(root)).toEqual([["html", "<Foo>"]]);
  });

  it.each([
    ["a label", "[a <br> b](x)\n"],
    ["an atx heading", "# a <br> b #\n"],
    ["a setext heading", "a <br> b\n===\n"],
  ])("unwraps an opener still open where %s ends", (_name, md) => {
    const [block] = parseBare(md).children;
    expect(JSON.stringify(block)).toContain('"value":"<br>"');
    expect(JSON.stringify(block)).not.toContain("mdxJsxTextElement");
  });

  it("keeps an element that pairs", () => {
    const [block] = parseBare("<toggle>\n  body\n</toggle>\n").children;
    expect(block?.type).toBe("mdxJsxFlowElement");
  });
});

describe("a tag the tokenizer cannot finish declines to what else reads `<`", () => {
  it.each([
    ["an autolink", "<https://x.y>\n", "link"],
    ["an email autolink", "<a@b.com>\n", "link"],
    ["an html comment", "<!-- c -->\n", "html"],
    ["text, past an unclosed tag", "an unclosed <Foo\n", "text"],
    ["text, past attributes on a closer", "</Foo bar>\n", "text"],
    ["text, past an unclosed attribute expression", "<Foo bar={x\n", "text"],
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
  "<toggle>",
  "</toggle>",
  "<x/>",
  "<y {...p}>",
  "<z w={1}>",
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
