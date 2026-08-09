import type { Nodes } from "mdast";
import { describe, expect, it } from "vitest";

import { parseMdast } from "../parse";

// The grammar half of the opaque contract, pinned in the package that owns it.
// Two properties, and the second is the one that breaks silently:
//
//  1. `<` is shared — autolinks, HTML comments and a bare `<50ms` reach the
//     tree instead of throwing, and unmodellable constructs arrive as opaque
//     nodes carrying their own markdown.
//  2. A real component tag is STILL JSX. htmlText also matches `<toggle>`, so
//     if precedence ever flips the eight MDX components silently stop
//     rendering — the file would open, look fine, and be wrong.

function types(md: string): string[] {
  const parsed = parseMdast(md);
  expect(parsed.ok, md).toBe(true);
  if (!parsed.ok) return [];
  const out: string[] = [];
  const walk = (node: Nodes): void => {
    out.push(
      node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement"
        ? `${node.type}[${node.name ?? "<>"}]`
        : node.type,
    );
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(parsed.root);
  return out;
}

function opaqueValues(md: string): string[] {
  const parsed = parseMdast(md);
  expect(parsed.ok, md).toBe(true);
  if (!parsed.ok) return [];
  const values: string[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === "opaqueBlock" || node.type === "opaqueInline") {
      values.push(node.value);
      return;
    }
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(parsed.root);
  return values;
}

describe("component precedence at `<`", () => {
  // If any of these becomes an `opaqueInline`/`opaqueBlock`, htmlText or
  // autolink has taken `<` back from JSX and the component is gone.
  const COMPONENTS: Array<[string, string]> = [
    ["callout", '<callout variant="info">\n  x\n</callout>\n'],
    ["toggle", "<toggle>\n  x\n</toggle>\n"],
    ["column_group", "<column_group>\n  <column>\n    x\n  </column>\n</column_group>\n"],
    ["video", '<video src="https://x.test/v.mp4" />\n'],
    ["media_embed", '<media_embed src="https://x.test/e" />\n'],
    ["file", '<file src="https://x.test/f.pdf" />\n'],
    ["date (flow)", '<date value="2026-07-01" />\n'],
    ["date (text)", 'Meet <date value="2026-07-01" /> then\n'],
  ];

  for (const [name, md] of COMPONENTS) {
    it(`${name} parses as JSX, not HTML`, () => {
      expect(types(md).some((type) => type.startsWith("mdxJsx"))).toBe(true);
      expect(opaqueValues(md)).toEqual([]);
    });
  }

  it("a tag whose content shares its line is ONE element, not two html tags", () => {
    // A block tag in text position has no editor node, so it goes opaque — but
    // as a single element covering both tags. htmlText would have matched the
    // open and close tags separately, leaving `x` stranded between them.
    expect(opaqueValues("<toggle>x</toggle>\n")).toEqual(["<toggle>x</toggle>"]);
  });

  it("an HTML-ish line inside a component cannot swallow its closing tag", () => {
    // htmlFlow's block branches run to the next blank line — enabled, the
    // `</callout>` here would be eaten and the document would not parse.
    expect(types("<callout>\n  <div>x</div>\n  more\n</callout>\n")).toContain(
      "mdxJsxFlowElement[callout]",
    );
  });
});

describe("`<` forms JSX alone cannot read", () => {
  it("angle autolinks parse as links", () => {
    expect(types("see <https://example.com> now\n")).toContain("link");
    expect(types("mail <a@b.test> now\n")).toContain("link");
  });

  it("HTML comments, declarations and instructions become opaque", () => {
    expect(opaqueValues("before <!-- c --> after\n")).toEqual(["<!-- c -->"]);
    expect(opaqueValues("<!-- a flow comment -->\n")).toEqual(["<!-- a flow comment -->"]);
    expect(opaqueValues('<?xml version="1.0"?>\n')).toEqual(['<?xml version="1.0"?>']);
    expect(opaqueValues("<!DOCTYPE html>\n")).toEqual(["<!DOCTYPE html>"]);
  });

  it("a `<` that starts nothing stays literal text", () => {
    expect(opaqueValues("returns in <50ms sometimes\n")).toEqual([]);
    expect(types("returns in <50ms sometimes\n")).toEqual(["root", "paragraph", "text"]);
  });

  it("genuinely malformed input is still a parse error", () => {
    for (const md of ["<Foo>x</Bar>\n", "<Foo>\n\nnever closed\n", "{unclosed\n"]) {
      expect(parseMdast(md).ok, md).toBe(false);
    }
  });
});

describe("opaque values", () => {
  it("hold unknown JSX and expressions as self-contained markdown", () => {
    expect(opaqueValues("<Steps>\n  body\n</Steps>\n")).toEqual(["<Steps>\n  body\n</Steps>"]);
    expect(opaqueValues("press <kbd>K</kbd> now\n")).toEqual(["<kbd>K</kbd>"]);
    expect(opaqueValues("value is {count} here\n")).toEqual(["{count}"]);
  });

  it("are free of the container prefixes a source slice would capture", () => {
    expect(opaqueValues("> <Steps>\n>   quoted\n> </Steps>\n")).toEqual([
      "<Steps>\n  quoted\n</Steps>",
    ]);
    expect(opaqueValues("- item\n\n  <Steps>\n    listed\n  </Steps>\n")).toEqual([
      "<Steps>\n  listed\n</Steps>",
    ]);
  });

  it("never form inside a fence — text constructs do not run there", () => {
    expect(opaqueValues("```\n<!-- c -->\n<div>x</div>\n```\n")).toEqual([]);
  });

  it("take the whole component when an attribute is not a plain string", () => {
    expect(opaqueValues("<callout draft>\n  x\n</callout>\n")).toEqual([
      "<callout draft>\n  x\n</callout>",
    ]);
    expect(opaqueValues('<date value="2026-07-01" foo="x" />\n')).toEqual([
      '<date value="2026-07-01" foo="x" />',
    ]);
  });
});
