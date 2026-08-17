import type { Node, Parent } from "mdast";
import { describe, expect, it } from "vitest";
import { parseScan } from "../scan-parse";
import { isThreadAnchorToken } from "../thread-anchor";
import {
  findThreadMarkers,
  insertThreadMarker,
  threadMarkerRemoval,
  threadMarkerText,
} from "../thread-marker";

const ANC = "anc_0123456789ab";
const OTHER = "anc_ffffffffffff";
const MARKER = threadMarkerText(ANC);

function isParent(node: Node): node is Parent {
  return "children" in node && Array.isArray((node as Parent).children);
}

/**
 * The document's shape with every marker node dropped — what inserting a marker
 * must leave untouched. Trailing whitespace on text is normalized, because the
 * one byte an insertion legitimately adds to a neighbouring node is the line
 * break carrying the marker's own line (a marker directly under a paragraph is
 * a lazy continuation of it: same blocks, same text, same rendering).
 */
function shapeWithoutMarkers(content: string): string {
  const strip = (node: Node): unknown => {
    const value = (node as { value?: string }).value;
    if (node.type === "html" && /inteligir:thread/u.test(String(value))) {
      return null;
    }
    if (!isParent(node)) {
      return { type: node.type, value: value === undefined ? null : value.trimEnd() };
    }
    const children = node.children.map(strip).filter((child) => child !== null);
    // A block that held nothing but the marker IS the marker's own block.
    if (children.length === 0 && node.children.length > 0) {
      return null;
    }
    return { type: node.type, children };
  };
  return JSON.stringify(strip(parseScan(content)));
}

describe("the anchor token grammar", () => {
  it("is anc_ plus twelve lowercase hex, and nothing else", () => {
    expect(isThreadAnchorToken(ANC)).toBe(true);
    expect(isThreadAnchorToken("anc_0123456789AB")).toBe(false);
    expect(isThreadAnchorToken("anc_0123456789")).toBe(false);
    expect(isThreadAnchorToken("anc_0123456789abc")).toBe(false);
    expect(isThreadAnchorToken("thr_0123456789ab")).toBe(false);
    expect(isThreadAnchorToken("")).toBe(false);
    // A token that could close the comment early would let a marker escape
    // its own syntax; the grammar makes it unrepresentable.
    expect(isThreadAnchorToken("x -->")).toBe(false);
    expect(() => threadMarkerText("x -->")).toThrow();
  });
});

describe("recognition is syntax-aware", () => {
  it("finds a block-level marker with exact offsets", () => {
    const content = `Para.\n${MARKER}\n`;
    const markers = findThreadMarkers(content);
    expect(markers.map((marker) => marker.anchor)).toEqual([ANC]);
    const found = markers[0];
    if (found === undefined) {
      throw new Error("no marker");
    }
    expect(content.slice(found.from, found.to)).toBe(MARKER);
  });

  it("ignores the identical characters inside a fenced code block", () => {
    expect(findThreadMarkers(`Para.\n\n\`\`\`md\n${MARKER}\n\`\`\`\n`)).toEqual([]);
  });

  it("ignores the identical characters inside inline code", () => {
    expect(findThreadMarkers(`Write \`${MARKER}\` to anchor.\n`)).toEqual([]);
  });

  it("ignores the identical characters inside frontmatter", () => {
    expect(findThreadMarkers(`---\nnote: "${MARKER}"\n---\n\nBody.\n`)).toEqual([]);
  });

  it("ignores a marker sharing its line with prose", () => {
    expect(findThreadMarkers(`Text ${MARKER} more text.\n`)).toEqual([]);
  });

  it("accepts a marker behind a container prefix (blockquote, list item)", () => {
    const quoted = findThreadMarkers(`> quoted\n> ${MARKER}\n`);
    expect(quoted.map((marker) => marker.anchor)).toEqual([ANC]);
    const listed = findThreadMarkers(`- item\n  ${MARKER}\n`);
    expect(listed.map((marker) => marker.anchor)).toEqual([ANC]);
  });

  it("finds adjacent markers separately, in source order", () => {
    const content = `Para.\n${MARKER}\n${threadMarkerText(OTHER)}\n`;
    expect(findThreadMarkers(content).map((marker) => marker.anchor)).toEqual([ANC, OTHER]);
  });

  it("ignores comments that are not thread markers", () => {
    expect(findThreadMarkers("<!-- plain -->\n<!-- inteligir:thread -->\n")).toEqual([]);
    expect(findThreadMarkers("<!-- inteligir:thread anc_NOTHEX0000 -->\n")).toEqual([]);
  });
});

describe("insertion computes a legal block boundary", () => {
  const cases: { name: string; doc: string; target: string }[] = [
    { name: "a paragraph", doc: "# H\n\nFirst para.\n\nSecond para.\n", target: "First para" },
    { name: "the file's first line", doc: "Only line.\n", target: "Only" },
    { name: "a file with no trailing newline", doc: "No newline", target: "No" },
    {
      name: "inside frontmatter",
      doc: "---\ntitle: t\ntasks: false\n---\n\nBody.\n",
      target: "title: t",
    },
    {
      name: "inside a fenced code block",
      doc: "Para.\n\n```js\nconst x = 1;\n```\n\nAfter.\n",
      target: "const x",
    },
    { name: "a list item", doc: "- one\n- two\n- three\n", target: "two" },
    {
      name: "a task line",
      doc: "# H\n\n- [ ] water the plants\n- [ ] feed the cat\n",
      target: "water",
    },
    { name: "a blockquote", doc: "> quoted line\n> more\n\nAfter.\n", target: "quoted" },
    { name: "a nested list item", doc: "- outer\n  - inner\n- next\n", target: "inner" },
  ];

  for (const testCase of cases) {
    it(`leaves the rest of the document parsing identically: ${testCase.name}`, () => {
      const offset = testCase.doc.indexOf(testCase.target);
      expect(offset).toBeGreaterThanOrEqual(0);
      const inserted = insertThreadMarker(testCase.doc, offset, ANC);
      // The anchor exists, is recognized, and nothing else about the document
      // changed shape — which is the whole safety property.
      expect(findThreadMarkers(inserted).map((marker) => marker.anchor)).toEqual([ANC]);
      expect(shapeWithoutMarkers(inserted)).toBe(shapeWithoutMarkers(testCase.doc));
    });
  }

  it("never lands inside the frontmatter block", () => {
    const doc = "---\ntitle: t\ntasks: false\n---\n\nBody.\n";
    const inserted = insertThreadMarker(doc, doc.indexOf("title"), ANC);
    const frontmatterEnd = inserted.indexOf("---", 3) + 3;
    expect(inserted.indexOf(MARKER)).toBeGreaterThan(frontmatterEnd);
    // The YAML still parses as frontmatter, unchanged.
    expect(parseScan(inserted).children[0]).toMatchObject({
      type: "yaml",
      value: "title: t\ntasks: false",
    });
  });

  it("never lands inside a fence", () => {
    const doc = "```js\nconst x = 1;\n```\n";
    const inserted = insertThreadMarker(doc, doc.indexOf("const"), ANC);
    expect(inserted.indexOf(MARKER)).toBeGreaterThan(inserted.lastIndexOf("```"));
  });

  it("keeps a task's anchor inside its own list item", () => {
    const doc = "- [ ] water the plants\n- [ ] feed the cat\n";
    const inserted = insertThreadMarker(doc, doc.indexOf("water"), ANC);
    expect(inserted).toBe(`- [ ] water the plants\n      ${MARKER}\n- [ ] feed the cat\n`);
    // Both tasks survive as tasks — the anchor did not split the list.
    const list = parseScan(inserted).children[0];
    expect(list?.type).toBe("list");
    expect(list?.type === "list" && list.children).toHaveLength(2);
  });

  it("appends to an empty document", () => {
    expect(insertThreadMarker("", 0, ANC)).toBe(`${MARKER}\n`);
  });
});

describe("the newline convention is preserved", () => {
  it("inserts and removes CRLF in a CRLF document", () => {
    const doc = "# Plans\r\n\r\nFirst para.\r\n";
    const inserted = insertThreadMarker(doc, doc.indexOf("First"), ANC);
    expect(inserted).toBe(`# Plans\r\n\r\nFirst para.\r\n${MARKER}\r\n`);
    expect(inserted.includes(`\n${MARKER}`)).toBe(true);
    expect(/[^\r]\n/u.test(inserted)).toBe(false);

    const marker = findThreadMarkers(inserted)[0];
    if (marker === undefined) {
      throw new Error("no marker");
    }
    const removal = threadMarkerRemoval(inserted, marker);
    expect(inserted.slice(0, removal.from) + inserted.slice(removal.to)).toBe(doc);
  });

  it("inserts LF in an LF document", () => {
    const doc = "# Plans\n\nFirst para.\n";
    expect(insertThreadMarker(doc, doc.indexOf("First"), ANC)).toBe(
      `# Plans\n\nFirst para.\n${MARKER}\n`,
    );
  });
});

describe("removal", () => {
  it("reverses an insertion byte-exactly", () => {
    const doc = "# Plans\n\nFirst paragraph.\n\n- [ ] a task\n";
    for (const target of ["paragraph", "a task"]) {
      const inserted = insertThreadMarker(doc, doc.indexOf(target), ANC);
      const marker = findThreadMarkers(inserted)[0];
      if (marker === undefined) {
        throw new Error(`no marker for ${target}`);
      }
      const removal = threadMarkerRemoval(inserted, marker);
      expect(inserted.slice(0, removal.from) + inserted.slice(removal.to)).toBe(doc);
    }
  });

  it("removes a marker on the first line together with its own terminator", () => {
    const content = `${MARKER}\nrest\n`;
    const marker = findThreadMarkers(content)[0];
    if (marker === undefined) {
      throw new Error("no marker");
    }
    const removal = threadMarkerRemoval(content, marker);
    expect(content.slice(0, removal.from) + content.slice(removal.to)).toBe("rest\n");
  });

  it("removes only the named marker when two sit adjacent", () => {
    const content = `Para.\n${MARKER}\n${threadMarkerText(OTHER)}\n`;
    const second = findThreadMarkers(content).find((marker) => marker.anchor === OTHER);
    if (second === undefined) {
      throw new Error("no second marker");
    }
    const removal = threadMarkerRemoval(content, second);
    expect(content.slice(0, removal.from) + content.slice(removal.to)).toBe(`Para.\n${MARKER}\n`);
  });
});
