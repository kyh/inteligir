import type { Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { MD_REMARK_PLUGINS, MD_STRINGIFY } from "../md-plugins";
import { parseMdast } from "../parse";

const textOf = (node: RootContent): string => {
  if (node.type === "text") {
    return node.value;
  }
  return "children" in node ? node.children.map(textOf).join("") : "";
};

// a container as its kind and what it holds, a paragraph as its text
type Reading = string | { [kind: string]: Reading[] };

const readingOf = (node: RootContent): Reading => {
  switch (node.type) {
    case "paragraph": {
      return textOf(node);
    }
    case "tabPanel": {
      return { [`panel ${node.label}`]: node.children.map(readingOf) };
    }
    case "column": {
      return { [`column ${node.width ?? "bare"}`]: node.children.map(readingOf) };
    }
    default: {
      return "children" in node ? { [node.type]: node.children.map(readingOf) } : node.type;
    }
  }
};

const readings = (md: string): Reading[] => parseMdast(md).root.children.map(readingOf);

const processor = unified()
  .use(remarkParse)
  .use(MD_REMARK_PLUGINS)
  .use(remarkStringify, MD_STRINGIFY)
  .freeze();

const stringified = (md: string): string => {
  const tree: Root = parseMdast(md).root;
  return processor.stringify(tree);
};

describe("the :::tabs markers", () => {
  it("read the same under CRLF as under LF, and the `\\r` stays with the terminator", () => {
    const lf = ":::tabs\n=== A\nhello\nthere\n=== B\nworld\n:::\n";
    expect(readings(lf)).toEqual([
      { tabGroup: [{ "panel A": ["hello\nthere"] }, { "panel B": ["world"] }] },
    ]);
    expect(readings(lf.replaceAll("\n", "\r\n"))).toEqual([
      { tabGroup: [{ "panel A": ["hello\r\nthere"] }, { "panel B": ["world"] }] },
    ]);
  });

  it("refuse content before the first panel, keeping the whole block as prose", () => {
    expect(readings(":::tabs\nloose\n=== A\nx\n:::\n")).toEqual([":::tabs\nloose\n=== A\nx\n:::"]);
  });
});

describe("a toggle and columns", () => {
  it("fold the blocks between an opener and its `:::`, nesting innermost-first", () => {
    const md = ":::toggle\nouter\n\n- item\n\n:::toggle\ninner\n:::\n:::\n\n:::toggle\n:::\n";
    expect(readings(md)).toEqual([
      { toggle: ["outer", { list: [{ listItem: ["item"] }] }, { toggle: ["inner"] }] },
      { toggle: [] },
    ]);
  });

  it("read a column's width, and a bare column as none", () => {
    expect(readings(":::columns\n:::column 50%\nleft\n:::\n:::column\nright\n:::\n:::\n")).toEqual([
      { columnGroup: [{ "column 50%": ["left"] }, { "column bare": ["right"] }] },
    ]);
  });

  it("read inside a quote and a list item", () => {
    expect(readings("> :::toggle\n> quoted\n> :::\n\n- :::toggle\n  listed\n  :::\n")).toEqual([
      { blockquote: [{ toggle: ["quoted"] }] },
      { list: [{ listItem: [{ toggle: ["listed"] }] }] },
    ]);
  });

  it("read a panel marker outside tabs as text", () => {
    expect(readings(":::toggle\n=== not a panel\n:::\n")).toEqual([
      { toggle: ["=== not a panel"] },
    ]);
  });
});

describe("an opener whose container cannot be read whole stays prose", () => {
  it.each([
    ["never closed", ":::toggle\nopen forever\n"],
    ["a column outside columns", ":::column\nx\n:::\n"],
    ["content between columns", ":::columns\nloose\n:::column\nx\n:::\n:::\n"],
    ["columns with no column", ":::columns\n:::\n"],
  ])("%s", (_name, md) => {
    expect(readings(md)).toEqual([md.trimEnd()]);
  });

  it("and the scan resumes after it", () => {
    expect(readings(":::toggle\nstray\n\n:::toggle\nkept\n:::\n")).toEqual([
      ":::toggle\nstray",
      { toggle: ["kept"] },
    ]);
    expect(readings(":::columns\n:::toggle\nx\n:::\n:::\n")).toEqual([
      ":::columns",
      { toggle: ["x"] },
      ":::",
    ]);
  });

  it("keeps the parsed paragraph whole, positions included", () => {
    const [paragraph] = parseMdast(":::toggle\nopen forever\n").root.children;
    expect(paragraph?.position?.start.offset).toBe(0);
  });

  it("costs one pass however many openers never close", () => {
    const md = ":::toggle\n".repeat(20_000);
    const started = performance.now();
    expect(readings(md)).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe("a container's markdown", () => {
  it.each([
    ["a list", ":::toggle\nsummary\n\n- a\n- b\n\n:::\n"],
    ["a quote", ":::toggle\nsummary\n\n> q\n\n:::\n"],
    ["a table", ":::toggle\nsummary\n\n| a |\n| - |\n| b |\n\n:::\n"],
    ["a list ending a tab panel", ":::tabs\n=== A\n- a\n\n:::\n"],
  ])(
    "leaves a blank line before `:::` after %s, which would read the marker as its own line",
    (_name, md) => {
      expect(stringified(md)).toBe(md);
      expect(stringified(stringified(md))).toBe(md);
    },
  );

  it.each([
    ["a list numbered from 2", ":::toggle\n\n2. two\n3. three\n\n:::\n"],
    ["a definition", ":::toggle\n\n[a]: https://example.com\n:::\n"],
  ])(
    "leaves a blank line after the marker before %s, which cannot end the marker's paragraph",
    (_name, md) => {
      expect(stringified(md)).toBe(md);
    },
  );

  it.each([
    ["a toggle", ":::toggle\n\n---\n\nbody\n:::\n", { toggle: ["thematicBreak", "body"] }],
    [
      "a tab panel",
      ":::tabs\n=== One\n\n---\n\nbody\n:::\n",
      { tabGroup: [{ "panel One": ["thematicBreak", "body"] }] },
    ],
    [
      "a column",
      ":::columns\n:::column\n\n---\n\nbody\n:::\n:::\n",
      { columnGroup: [{ "column bare": ["thematicBreak", "body"] }] },
    ],
  ])(
    "leaves a blank line after the marker before a rule opening %s, which would underline the marker as a heading",
    (_name, md, reading) => {
      expect(readings(md)).toEqual([reading]);
      expect(stringified(md)).toBe(md);
    },
  );

  it("writes a column's width beside its marker and an empty container as its two markers", () => {
    const md = ":::columns\n:::column 33.33%\nleft\n:::\n\n:::column\n:::\n:::\n";
    expect(stringified(md)).toBe(md);
  });
});
