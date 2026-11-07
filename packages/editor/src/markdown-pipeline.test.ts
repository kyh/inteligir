import { assert, describe, expect, it } from "vitest";
import { createSlateEditor, ElementApi } from "platejs";
import type { Descendant } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { articleBlocks } from "@repo/editor/codec/item-markdown";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { stringProp } from "@repo/editor/node-props";
import {
  RoundTripError,
  analyzeMarkdown,
  parseMarkdown,
  roundTrip,
  serializeNote,
} from "@repo/editor/markdown/markdown-doc";
import { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";
import { parseMdast } from "@repo/notes/markdown/parse";
import { parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

describe("a block a list item opens with", () => {
  const listProps = (md: string): Record<string, unknown>[] => {
    const parsed = parseMarkdown(md);
    assert(parsed.ok);
    return parsed.value.map(({ checked, indent, listRestartPolite, listStyleType, type }) => ({
      checked,
      indent,
      listRestartPolite,
      listStyleType,
      type,
    }));
  };
  const bare = (type: string): Record<string, unknown> => ({
    checked: undefined,
    indent: undefined,
    listRestartPolite: undefined,
    listStyleType: undefined,
    type,
  });

  it.each([
    ["an embed", "- ![](https://a.b/c.png)\n", "media_embed"],
    ["an image", "- ![alt](https://a.b/c.png)\n", "img"],
    ["a fence", "- ```\n  code\n  ```\n", "code_block"],
    ["a quote", "- > words\n", "blockquote"],
  ])("lands %s as a paste and an import both hold it, out of the list", (_name, md, type) => {
    expect(listProps(md)).toStrictEqual([bare(type)]);
  });

  it("gives a to-do's box its own line above what the item held", () => {
    expect(listProps("- [x] ![](https://a.b/c.png)\n")).toStrictEqual([
      { ...bare("p"), checked: true, indent: 1, listStyleType: "todo" },
      bare("media_embed"),
    ]);
  });

  it("restarts a list's numbers on its first line, past a block it opened with", () => {
    expect(listProps("3. ![](https://a.b/c.png) words\n4. more\n")).toStrictEqual([
      bare("media_embed"),
      { ...bare("p"), indent: 1, listRestartPolite: 3, listStyleType: "decimal" },
      { ...bare("p"), indent: 1, listStyleType: "decimal" },
    ]);
  });
});

describe("owned parse", () => {
  it("keeps a tag that cannot pair as its own bytes, where MDX would refuse the file", () => {
    const unpaired = [
      "<Foo>\n\nnever closed\n",
      "<Foo>broken</Bar>\n",
      "text </Bar> more\n",
      "{unclosed brace\n",
    ];
    for (const md of unpaired) {
      expect(analyzeMarkdown(md).kind, md).toBe("canonical");
      expect(roundTrip(md), md).toBe(md);
    }
  });

  it("keeps html-ish bytes inside inline code intact (htmlToJsx regression)", () => {
    const md = 'use `<div class="x">` here\n';
    expect(roundTrip(md)).toBe(md);
    expect(analyzeMarkdown(md).kind).toBe("canonical");
  });

  it("reads braces as prose: the dialect has no expressions", () => {
    const md = "config { noServer: true } here\n";
    expect(roundTrip(md)).toBe(md);
    expect(analyzeMarkdown(md).kind).toBe("canonical");
  });

  it("keeps an import line as prose", () => {
    const md = "import X from 'x'\n\nhello\n";
    expect(analyzeMarkdown(md).kind).toBe("canonical");
    expect(roundTrip(md)).toBe(md);
  });
});

const opaqueValues = (md: string): string[] => {
  const parsed = parseMarkdown(md);
  expect(parsed.ok, md).toBe(true);
  if (!parsed.ok) {
    return [];
  }
  const values: string[] = [];
  const walk = (node: Descendant): void => {
    if (!ElementApi.isElement(node)) {
      return;
    }
    if (node.type === "opaque") {
      values.push(stringProp(node, "source") ?? "");
      return;
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  for (const child of parsed.value) {
    walk(child);
  }
  return values;
};

const expectOpaque = (md: string, values: string[]): void => {
  expect(opaqueValues(md), md).toStrictEqual(values);
  expect(roundTrip(md), md).toBe(md);
  expect(analyzeMarkdown(md).kind, md).toBe("canonical");
};

describe("opaque nodes (constructs with no editor node)", () => {
  it("carries an unknown tag and what it encloses verbatim", () => {
    expectOpaque('<Foo bar="1">text body</Foo>\n', ['<Foo bar="1">text body</Foo>']);
    expectOpaque("<Steps>\nstep body\n</Steps>\n", ["<Steps>\nstep body\n</Steps>"]);
  });

  it("carries each tag alone where a blank line parts it from its closer", () => {
    expectOpaque("<Steps>\n\nstep body\n\n</Steps>\n", ["<Steps>", "</Steps>"]);
  });

  it("carries lowercase HTML-ish tags verbatim", () => {
    expectOpaque('<div align="center">x</div>\n', ['<div align="center">x</div>']);
    expectOpaque("press <kbd>K</kbd> now\n", ["<kbd>K</kbd>"]);
  });

  it("reads a fragment as text: `<>` opens no tag", () => {
    expect(opaqueValues("<>fragment</>\n")).toStrictEqual([]);
  });

  it("carries HTML comments, both flow and inline", () => {
    expectOpaque("before\n\n<!-- a flow comment -->\n\nafter\n", ["<!-- a flow comment -->"]);
    expectOpaque("before <!-- inline comment --> after\n", ["<!-- inline comment -->"]);
  });

  it("carries processing instructions, and a tag that cannot pair", () => {
    expectOpaque('<?xml version="1.0"?>\n', ['<?xml version="1.0"?>']);
    expectOpaque("value is {count} here\n", []);
    expectOpaque("text </Bar> and <br> more\n", ["</Bar>", "<br>"]);
  });

  it("carries a `<callout>` verbatim: the callout is the alert", () => {
    expectOpaque('<callout variant="info">x</callout>\n', ['<callout variant="info">x</callout>']);
  });

  it("carries a jsx-style block tag as the html tag it is", () => {
    expectOpaque('Meet <date value="2026-07-01" /> ok\n', ['<date value="2026-07-01" />']);
    expectOpaque("<toggle>x</toggle>\n", ["<toggle>x</toggle>"]);
  });

  it("reads a date no calendar has as text", () => {
    const md = "Meet @2026-02-30 ok\n";
    expect(opaqueValues(md)).toStrictEqual([]);
    expect(JSON.stringify(parseMarkdown(md))).not.toContain('"type":"date"');
    expect(roundTrip(md)).toBe(md);
  });

  it("leaves the app's own blocks modelled, never opaque", () => {
    const md = [
      ":::toggle",
      "y",
      ":::",
      "",
      ":::columns",
      ":::column",
      "z",
      ":::",
      "",
      ":::column 50%",
      "w",
      ":::",
      ":::",
      "",
      "![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
      "",
      "![](https://twitter.com/x/status/1)",
      "",
      "![](https://example.com/a.pdf)",
      "",
      "![](https://example.com/page)",
      "",
      "Meet on @2026-07-01 at noon, <u>underlined</u>.",
      "",
    ].join("\n");
    expect(opaqueValues(md)).toStrictEqual([]);
    expect(analyzeMarkdown(md).kind).toBe("canonical");
    const parsed = parseMarkdown(md);
    const types = parsed.ok ? parsed.value.map((node) => node.type) : [];
    expect(types).toStrictEqual([
      "toggle",
      "column_group",
      "video",
      "media_embed",
      "file",
      "media_embed",
      "p",
    ]);
    const json = JSON.stringify(parsed.ok ? parsed.value : []);
    expect(json).toContain('"type":"date"');
    expect(json).toContain('"underline":true');
  });

  it("keeps an element inside a container prefix-correct", () => {
    expectOpaque("> <Steps>\n> quoted\n> </Steps>\n", ["<Steps>\nquoted\n</Steps>"]);
    expectOpaque(":::toggle\n<Steps>nested</Steps>\n:::\n", ["<Steps>nested</Steps>"]);
  });

  it("keeps html-ish bytes out of fenced code (opaque never runs inside a fence)", () => {
    const md = "```\n<!-- not a comment -->\n<div>x</div>\n```\n";
    expect(opaqueValues(md)).toStrictEqual([]);
    expect(roundTrip(md)).toBe(md);
  });
});

describe("wiki links", () => {
  it("leaves standard links and images untouched (construct fallthrough)", () => {
    expect(roundTrip("[x](https://example.com/y) plain\n")).toBe(
      "[x](https://example.com/y) plain\n",
    );
    expect(roundTrip("![alt](https://example.com/i.png)\n")).toBe(
      "![alt](https://example.com/i.png)\n",
    );
    const parsed = parseMdast("[x](https://example.com/y) and ![alt](https://example.com/i.png)\n");
    const json = JSON.stringify(parsed.root);
    expect(json).toContain('"type":"link"');
    expect(json).toContain('"type":"image"');
    expect(json).not.toContain("wiki");
  });

  it("keeps a body's anchors, aliases and embed sizes, and drops its padding", () => {
    const md = "See [[padded]] and [[a#b|c]] plus ![[img.png|300]] now.\n";
    expect(roundTrip(md)).toBe(md);
    expect(roundTrip("See [[ padded ]] now.\n")).toBe("See [[padded]] now.\n");
  });

  it("rejects empty, unclosed, and single-] bodies back to text", () => {
    for (const md of ["[[]] empty\n", "an [[not closed\n", "a [[a]b]] partial\n"]) {
      const parsed = parseMarkdown(md);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        continue;
      }
      expect(JSON.stringify(parsed.value)).not.toContain("wikiLink");
      expect(JSON.stringify(parsed.value)).not.toContain("wikiEmbed");
    }
    const nested = parseMarkdown("[[a[[b]] weird\n");
    expect(nested.ok).toBe(true);
    if (!nested.ok) {
      return;
    }
    const json = JSON.stringify(nested.value);
    expect(json).toContain('"text":"[[a"');
    expect(json).toContain('"title":"b"');
  });

  it("produces inline-void nodes in the library's own shape", () => {
    const parsed = parseMarkdown("See [[Some Note|alias]] and ![[embed.png]].\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const json = JSON.stringify(parsed.value);
    expect(json).toContain('"type":"wikiLink"');
    expect(json).toContain('"title":"Some Note","type":"wikiLink","alias":"alias"');
    expect(json).toContain('"type":"wikiEmbed"');
    expect(json).toContain('"itemId":null,"title":"embed.png"');
  });
});

describe("parseWikiBody (display-time helper)", () => {
  it("splits target / anchor / alias", () => {
    expect(parseWikiBody("a#b|c")).toStrictEqual({ alias: "c", anchor: "b", target: "a" });
    expect(parseWikiBody("Note")).toStrictEqual({ target: "Note" });
    expect(parseWikiBody(" padded ")).toStrictEqual({ target: "padded" });
    expect(parseWikiBody("Other|friendly")).toStrictEqual({ alias: "friendly", target: "Other" });
    expect(parseWikiBody("a#sec")).toStrictEqual({ anchor: "sec", target: "a" });
  });

  it("drops an empty alias; a trailing # is title text (tight-# rule)", () => {
    expect(parseWikiBody("a|")).toStrictEqual({ target: "a" });
    expect(parseWikiBody("a#")).toStrictEqual({ target: "a#" });
    expect(parseWikiBody("a#|x")).toStrictEqual({ alias: "x", target: "a#" });
  });

  it("the LAST pipe splits the alias (a piped title keeps its pipes)", () => {
    expect(parseWikiBody("a|b|c")).toStrictEqual({ alias: "c", target: "a|b" });
    expect(parseWikiBody("Status | Draft|9e64c3df-c1e2-4a4d-8c07-91528f422413")).toStrictEqual({
      alias: "9e64c3df-c1e2-4a4d-8c07-91528f422413",
      target: "Status | Draft",
    });
  });
});

const editor = () => createSlateEditor({ plugins: BASE_KIT });

describe("serialize rules", () => {
  it("does not drop toggle nodes (Plate ships no toggle rule)", () => {
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [
        { children: [{ children: [{ text: "hidden" }], type: "p" }], type: "toggle" },
        { children: [{ text: "after" }], type: "p" },
      ],
    });
    expect(out).toBe(":::toggle\nhidden\n:::\n\nafter\n");
  });

  it("serializes a collapsed/expanded toggle as its markers alone", () => {
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [{ children: [{ children: [{ text: "x" }], type: "p" }], type: "toggle" }],
    });
    expect(out).toBe(":::toggle\nx\n:::\n");
  });

  it("serializes date nodes as `@` and the date", () => {
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [
        {
          children: [
            { text: "Meet " },
            { children: [{ text: "" }], date: "2026-07-01", type: "date" },
            { text: " ok" },
          ],
          type: "p",
        },
      ],
    });
    expect(out).toBe("Meet @2026-07-01 ok\n");
  });

  it("emits alert blockquotes verbatim with marks preserved", () => {
    const md = "> [!TIP]\n> Has **bold** and [[Wiki Link]] and $$x^2$$ inline.\n";
    expect(roundTrip(md)).toBe(md);
  });

  it("never serializes node ids", () => {
    // NodeIdPlugin is off under NODE_ENV=test, so ids are injected by hand
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [
        { children: [{ text: "" }], id: "v1", type: "video", url: "https://y.tb/1" },
        { children: [{ text: "" }], id: "m1", type: "media_embed", url: "https://t.co/1" },
        { children: [{ text: "" }], id: "f1", type: "file", url: "https://e.com/a.pdf" },
        {
          children: [{ children: [{ text: "t" }], id: "p2", type: "p" }],
          id: "t1",
          type: "toggle",
        },
      ],
    });
    expect(out).toBe(
      "![](https://y.tb/1)\n\n![](https://t.co/1)\n\n![](https://e.com/a.pdf)\n\n:::toggle\nt\n:::\n",
    );
  });

  it("emits bare emails as literal bytes, never <angle> autolinks (V2)", () => {
    const bare = "contact a@b.cd today\n";
    expect(roundTrip(bare)).toBe(bare);
    expect(analyzeMarkdown(bare).kind).toBe("canonical");
    // the resource form is indistinguishable from a parsed literal in the model
    expect(roundTrip("[a@b.cd](mailto:a@b.cd)\n")).toBe("a@b.cd\n");
    const named = "[write us](mailto:a@b.cd)\n";
    expect(roundTrip(named)).toBe(named);
    const tel = "[tel:123](tel:123)\n";
    expect(roundTrip(tel)).toBe(tel);
  });

  it("keeps bare https literals byte-canonical (resourceLink must not regress them)", () => {
    const md = "see https://example.com now\n";
    expect(roundTrip(md)).toBe(md);
    expect(analyzeMarkdown(md).kind).toBe("canonical");
  });

  it("never emits `---` as a document's first line (V5 frontmatter guard)", () => {
    expect(roundTrip("---\n")).toBe("***\n");
    expect(roundTrip("***\n***\n")).toBe("***\n\n---\n");
    expect(roundTrip("***\n\nkey: value\n\n***\n")).toBe("***\n\nkey: value\n\n---\n");
    expect(roundTrip("x\n\n---\n")).toBe("x\n\n---\n");
  });

  it("keeps a fence that opens a body as a code block the library can hold", () => {
    expect(roundTrip("---\ntitle: x\n---\n\nbody\n")).toBe("```yaml\ntitle: x\n```\n\nbody\n");
    const ids = ["b1", "b2"].values();
    const page = articleBlocks("---\ntitle: x\n---\n\nbody\n", () => ids.next().value ?? "");
    expect(page?.blocks).toHaveLength(2);
    expect(page?.blocks[0]?.block).toMatchObject({ lang: "yaml", type: "code_block" });
  });

  it("writes url-less media as an empty image, which reads back as one", () => {
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [{ children: [{ text: "" }], type: "file" }],
    });
    expect(out).toBe("![]()\n");
    expect(roundTrip(out)).toBe(out);
    expect(analyzeMarkdown(out).kind).toBe("canonical");
  });

  it("pads ragged tables into a pass-1 fixpoint (V4)", () => {
    const out = roundTrip("| a | b |\n| - | - |\n| 1 |\n");
    expect(out).toBe("| a | b |\n| - | - |\n| 1 | ​ |\n");
    expect(roundTrip(out)).toBe(out);
  });

  it("persists table column alignment across the round-trip", () => {
    const out = roundTrip("| a |\n|:-:|\n| 1 |\n");
    expect(out).toBe("|  a  |\n| :-: |\n|  1  |\n");
    expect(roundTrip(out)).toBe(out);
    expect(analyzeMarkdown("| a |\n|:-:|\n| 1 |\n").kind).toBe("normalizes");
  });

  it("keeps empty todos checkable via the ZWSP placeholder", () => {
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [
        { checked: false, children: [{ text: "" }], indent: 1, listStyleType: "todo", type: "p" },
        { checked: true, children: [{ text: "" }], indent: 1, listStyleType: "todo", type: "p" },
      ],
    });
    expect(out).toBe("- [ ] ​\n- [x] ​\n");
    expect(roundTrip(out)).toBe(out);
    expect(analyzeMarkdown(out).kind).toBe("canonical");
  });
});

describe("the round trip's API", () => {
  it("parseMarkdown feeds the same bytes the round trip serializes (seed-path parity)", () => {
    const md = "# Hi\n\n- one\n- two\n\n> [!NOTE]\n> alert\n";
    const parsed = parseMarkdown(md);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const out = serializeNote(createSlateEditor({ plugins: BASE_KIT }), parsed.value);
    expect(out).toBe(roundTrip(md));
  });

  it("parseMarkdown answers why it cannot hold a note instead of a degraded value", () => {
    const parsed = parseMarkdown(`${"> ".repeat(3000)}x\n`);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.reason.kind).toBe("too-deep");
  });

  it("roundTrip throws typed errors carrying the reason", () => {
    const thrown = ((): RoundTripError | null => {
      try {
        roundTrip(`${"> ".repeat(3000)}x\n`);
        return null;
      } catch (error) {
        if (error instanceof RoundTripError) {
          return error;
        }
        throw error;
      }
    })();
    assert(thrown !== null, "roundTrip must throw where the editor cannot hold the note");
    expect(thrown.reason.kind).toBe("too-deep");
    expect(thrown.message).toMatch(/nests deeper/u);
  });

  it("names a file holding the codec's article section a loss: the live editor holds no section", () => {
    const md = "# Note\n\nmine\n\n:::article\n\nThe page.\n\n:::\n";
    expect(analyzeMarkdown(md)).toStrictEqual({ kind: "roundtrip-loss" });
  });

  it("classifies conversion stack overflow as too deep instead of throwing (V1)", () => {
    const deep = `${"> ".repeat(3000)}x\n`;
    expect(analyzeMarkdown(deep)).toStrictEqual({ kind: "too-deep" });
    expect(() => roundTrip(deep)).toThrow(RoundTripError);
  });
});
