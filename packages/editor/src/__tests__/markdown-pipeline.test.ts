import { describe, expect, it } from "vitest";
import { createSlateEditor, ElementApi, type Descendant } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { stringProp } from "@repo/editor/node-props";
import {
  MD_STRINGIFY,
  ParseFailedError,
  analyzeMarkdown,
  describeRawReason,
  parseMarkdown,
  roundTrip,
} from "@repo/editor/markdown/markdown-doc";
import { parseMdast } from "@repo/notes/markdown/parse";
import { parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

// In-tree translations of the scratchpad probe scenarios (rt/probe1-6) that
// aren't already pinned by the fixture matrix: the failure modes the owned
// parse exists to kill, and the unit surface of the wiki tokenizer / body
// parser.

describe("owned parse (probe1/2/3 translations)", () => {
  it("throws real errors instead of deserializeMd's silent degradation", () => {
    // Each of these produced a mangled, non-idempotent model under
    // deserializeMd (probe1); under the owned parse they are honest failures.
    // The list is short on purpose: a tag has to be genuinely BROKEN to fail
    // now, so everything a well-formed document can hold parses.
    const parseErrors = [
      "<Foo>\n\nnever closed\n",
      "<Foo>broken</Bar>\n",
      "text </Bar> more\n",
      "{unclosed brace\n",
    ];
    for (const md of parseErrors) {
      const result = parseMdast(md);
      expect(result.ok, md).toBe(false);
      if (result.ok) continue;
      expect(result.failure.message.length).toBeGreaterThan(0);
    }
    // Positioned errors carry the line for the badge tooltip.
    const positioned = parseMdast("first\n\n<Foo>broken</Bar>\n");
    expect(positioned.ok).toBe(false);
    if (!positioned.ok) expect(positioned.failure.line).toBe(3);
  });

  it("keeps html-ish bytes inside inline code intact (htmlToJsx regression)", () => {
    // deserializeMd's regex pre-pass rewrote `class=` → `className=` INSIDE
    // code spans/fences (probe2). The owned parse never touches raw source.
    const md = 'use `<div class="x">` here\n';
    expect(roundTrip(md)).toBe(md);
    expect(analyzeMarkdown(md).canonical).toBe(true);
  });

  it("parses expressions under agnostic MDX instead of crashing (acorn difference)", () => {
    // With Plate's remarkMdx (acorn), `config { noServer: true }` THROWS
    // "Could not parse expression with acorn". Agnostic mode parses it as an
    // expression, which the opaque node then carries byte-for-byte.
    const md = "config { noServer: true } here\n";
    expect(roundTrip(md)).toBe(md);
    expect(analyzeMarkdown(md).canonical).toBe(true);
  });

  it("keeps `import X from 'x'` as prose (no mdxjsEsm under agnostic MDX)", () => {
    const md = "import X from 'x'\n\nhello\n";
    expect(analyzeMarkdown(md).canonical).toBe(true);
    expect(roundTrip(md)).toBe(md);
  });
});

// Every opaque `value` in the parsed model, in document order.
function opaqueValues(md: string): string[] {
  const parsed = parseMarkdown(md);
  expect(parsed.ok, md).toBe(true);
  if (!parsed.ok) return [];
  const values: string[] = [];
  const walk = (node: Descendant): void => {
    if (!ElementApi.isElement(node)) return;
    if (node.type === "opaqueBlock" || node.type === "opaqueInline") {
      values.push(stringProp(node, "value") ?? "");
      return;
    }
    node.children.forEach(walk);
  };
  parsed.value.forEach(walk);
  return values;
}

// A construct the editor has no node for is held verbatim rather than refused.
// `roundTrip(md) === md` is the whole contract: the bytes survive an edit
// anywhere else in the document. Anything that fails here corrupts a file.
function expectOpaque(md: string, values: string[]): void {
  expect(opaqueValues(md), md).toEqual(values);
  expect(roundTrip(md), md).toBe(md);
  expect(analyzeMarkdown(md).canonical, md).toBe(true);
}

describe("opaque nodes (constructs with no editor node)", () => {
  it("carries unknown components verbatim", () => {
    expectOpaque('<Foo bar="1">text body</Foo>\n', ['<Foo bar="1">text body</Foo>']);
    expectOpaque("<Steps>\n  step body\n</Steps>\n", ["<Steps>\n  step body\n</Steps>"]);
  });

  it("carries lowercase HTML-ish tags verbatim", () => {
    expectOpaque('<div align="center">x</div>\n', ['<div align="center">x</div>']);
    expectOpaque("press <kbd>K</kbd> now\n", ["<kbd>K</kbd>"]);
  });

  it("carries fragments verbatim", () => {
    expectOpaque("<>\n  fragment\n</>\n", ["<>\n  fragment\n</>"]);
  });

  it("carries HTML comments, both flow and inline", () => {
    expectOpaque("before\n\n<!-- a flow comment -->\n\nafter\n", ["<!-- a flow comment -->"]);
    expectOpaque("before <!-- inline comment --> after\n", ["<!-- inline comment -->"]);
  });

  it("carries processing instructions and expressions", () => {
    expectOpaque('<?xml version="1.0"?>\n', ['<?xml version="1.0"?>']);
    expectOpaque("value is {count} here\n", ["{count}"]);
  });

  it("carries an allowed tag whose attributes are not plain strings", () => {
    // Bare booleans, braced expressions and spreads do not survive
    // parseAttributes/propsToAttributes — the element goes opaque WHOLE rather
    // than losing the attribute on the first save.
    expectOpaque("<callout draft>\n  x\n</callout>\n", ["<callout draft>\n  x\n</callout>"]);
    expectOpaque("<callout {...props}>\n  x\n</callout>\n", [
      "<callout {...props}>\n  x\n</callout>",
    ]);
    expectOpaque("<column_group>\n  <column width={50}>\n    x\n  </column>\n</column_group>\n", [
      "<column width={50}>\n  x\n</column>",
    ]);
  });

  it("carries unknown attr names on <date> (Plate's rule keeps only `value`)", () => {
    // Unlike the flow tags, date's deserialize DROPS everything but `value` —
    // modelling it would silently delete `foo` on the first rich save.
    expectOpaque('Meet <date value="2026-07-01" foo="x" /> ok\n', [
      '<date value="2026-07-01" foo="x" />',
    ]);
  });

  it("leaves the app's own components modelled, never opaque", () => {
    const md = [
      "```inteligir-callout",
      "info",
      "x",
      "```",
      "",
      "<toggle>",
      "  y",
      "</toggle>",
      "",
      "<column_group>",
      "  <column>",
      "    z",
      "  </column>",
      "",
      "  <column>",
      "    w",
      "  </column>",
      "</column_group>",
      "",
      '<video src="https://youtube.com/watch?v=1" />',
      "",
      '<media_embed src="https://twitter.com/x/status/1" />',
      "",
      '<file src="https://example.com/a.pdf" />',
      "",
      'Meet on <date value="2026-07-01" /> at noon.',
      "",
    ].join("\n");
    expect(opaqueValues(md)).toEqual([]);
    expect(analyzeMarkdown(md).canonical).toBe(true);
  });

  it("keeps an opaque block inside a container prefix-correct", () => {
    // The value is RE-SERIALIZED, never sliced out of the source: a slice would
    // capture the `> ` markers and the stringifier would add a second set.
    expectOpaque("> <Steps>\n>   quoted\n> </Steps>\n", ["<Steps>\n  quoted\n</Steps>"]);
    // Inside a callout fence the body re-parses as markdown, so a JSX
    // construct there is opaque WITHIN the callout's children.
    expectOpaque("```inteligir-callout\ninfo\n<Steps>\n  nested\n</Steps>\n```\n", [
      "<Steps>\n  nested\n</Steps>",
    ]);
  });

  it("keeps html-ish bytes out of fenced code (opaque never runs inside a fence)", () => {
    const md = "```\n<!-- not a comment -->\n<div>x</div>\n```\n";
    expect(opaqueValues(md)).toEqual([]);
    expect(roundTrip(md)).toBe(md);
  });
});

describe("wiki links (probe4 translations)", () => {
  it("leaves standard links and images untouched (construct fallthrough)", () => {
    // micromark prepends our constructs; a failed [[ / ![[ attempt falls
    // through to the stock link/image constructs.
    expect(roundTrip("[x](https://example.com/y) plain\n")).toBe(
      "[x](https://example.com/y) plain\n",
    );
    expect(roundTrip("![alt](https://example.com/i.png)\n")).toBe(
      "![alt](https://example.com/i.png)\n",
    );
    const parsed = parseMdast("[x](https://example.com/y) and ![alt](https://example.com/i.png)\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const json = JSON.stringify(parsed.root);
    expect(json).toContain('"type":"link"');
    expect(json).toContain('"type":"image"');
    expect(json).not.toContain("wiki");
  });

  it("keeps body bytes verbatim (padding, anchors, aliases, embed sizes)", () => {
    const md = "See [[ padded ]] and [[a#b|c]] plus ![[img.png|300]] now.\n";
    expect(roundTrip(md)).toBe(md);
  });

  it("rejects empty, unclosed, and single-] bodies back to text", () => {
    // The whole construct falls through to plain text (then normal `[` escaping
    // applies on re-serialize — churn, but never a wiki node).
    for (const md of ["[[]] empty\n", "an [[not closed\n", "a [[a]b]] partial\n"]) {
      const parsed = parseMarkdown(md);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(JSON.stringify(parsed.value)).not.toContain("wikiLink");
      expect(JSON.stringify(parsed.value)).not.toContain("wikiEmbed");
    }
    // Nested open `[[a[[b]]`: the outer attempt noks on the inner `[`, whose
    // own `[[b]]` then parses — outer bytes stay text, inner becomes a link.
    const nested = parseMarkdown("[[a[[b]] weird\n");
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    const json = JSON.stringify(nested.value);
    expect(json).toContain('"text":"[[a"');
    expect(json).toContain('"body":"b"');
  });

  it("produces inline-void nodes with verbatim body", () => {
    const parsed = parseMarkdown("See [[Some Note|alias]] and ![[embed.png]].\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const json = JSON.stringify(parsed.value);
    expect(json).toContain('"type":"wikiLink"');
    expect(json).toContain('"body":"Some Note|alias"');
    expect(json).toContain('"type":"wikiEmbed"');
    expect(json).toContain('"body":"embed.png"');
  });
});

describe("parseWikiBody (display-time helper)", () => {
  it("splits target / anchor / alias", () => {
    expect(parseWikiBody("a#b|c")).toEqual({ alias: "c", anchor: "b", target: "a" });
    expect(parseWikiBody("Note")).toEqual({ target: "Note" });
    expect(parseWikiBody(" padded ")).toEqual({ target: "padded" });
    expect(parseWikiBody("Other|friendly")).toEqual({ alias: "friendly", target: "Other" });
    expect(parseWikiBody("a#sec")).toEqual({ anchor: "sec", target: "a" });
  });

  it("drops an empty alias; a trailing # is title text (tight-# rule)", () => {
    expect(parseWikiBody("a|")).toEqual({ target: "a" });
    expect(parseWikiBody("a#")).toEqual({ target: "a#" });
    expect(parseWikiBody("a#|x")).toEqual({ alias: "x", target: "a#" });
  });

  it("the LAST pipe splits the alias (a piped title keeps its pipes)", () => {
    expect(parseWikiBody("a|b|c")).toEqual({ alias: "c", target: "a|b" });
    expect(parseWikiBody("Status | Draft|9e64c3df-c1e2-4a4d-8c07-91528f422413")).toEqual({
      alias: "9e64c3df-c1e2-4a4d-8c07-91528f422413",
      target: "Status | Draft",
    });
  });
});

const editor = () => createSlateEditor({ plugins: BASE_KIT });

describe("serialize rules (probe1 §5 / probe5 translations)", () => {
  it("does not drop toggle nodes (Plate ships no toggle rule)", () => {
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [
        { children: [{ children: [{ text: "hidden" }], type: "p" }], type: "toggle" },
        { children: [{ text: "after" }], type: "p" },
      ],
    });
    expect(out).toContain("<toggle>");
    expect(out).toContain("hidden");
    expect(out).toContain("after");
  });

  it("serializes a collapsed/expanded toggle with zero attributes", () => {
    // Open state lives in the toggle plugin's store (openIds), never on the
    // node — the emitted tag must stay bare.
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [{ children: [{ children: [{ text: "x" }], type: "p" }], type: "toggle" }],
    });
    expect(out).toBe("<toggle>\n  x\n</toggle>\n");
  });

  it("serializes date nodes in the value-attribute form (never rawDate)", () => {
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
    expect(out).toBe('Meet <date value="2026-07-01" /> ok\n');
  });

  it("emits alert blockquotes verbatim with marks preserved (probe5 fidelity)", () => {
    const md = "> [!TIP]\n> Has **bold** and [[Wiki Link]] and $$x^2$$ inline.\n";
    expect(roundTrip(md)).toBe(md);
  });

  it("never serializes node ids into vocabulary attributes", () => {
    // NodeIdPlugin (a Plate core default, off under NODE_ENV=test — so this
    // test injects ids explicitly) puts `id` on every live-editor block;
    // Plate's default callout/media rules would leak it as an `id="…"` attr.
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [
        {
          children: [{ children: [{ text: "x" }], id: "p1", type: "p" }],
          id: "c1",
          type: "callout",
          variant: "info",
        },
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
    expect(out).not.toContain("id=");
    expect(out).toContain("```inteligir-callout");
    expect(out).toContain('<video src="https://y.tb/1" />');
    expect(out).toContain('<file src="https://e.com/a.pdf" />');
    expect(out).toContain("<toggle>");
  });

  it("emits bare emails as literal bytes, never <angle> autolinks (V2)", () => {
    // Left to gfm's defaults, email literals reach mdast-util-to-markdown's
    // formatLinkAsAutolink and come back as `<a@b.cd>` — unparseable under
    // MDX, so a richSafe:true file is corrupted by its first save.
    const bare = "contact a@b.cd today\n";
    expect(roundTrip(bare)).toBe(bare);
    expect(analyzeMarkdown(bare).canonical).toBe(true);
    // The explicit resource form is indistinguishable from a parsed literal
    // in the model, so it normalizes to the literal (letters diverge → Raw).
    expect(roundTrip("[a@b.cd](mailto:a@b.cd)\n")).toBe("a@b.cd\n");
    // mailto links whose text is NOT the address stay resource links.
    const named = "[write us](mailto:a@b.cd)\n";
    expect(roundTrip(named)).toBe(named);
    // Non-gfm protocols must never take the angle-autolink form either
    // (resourceLink: true) — `<tel:123>` would not re-parse.
    const tel = "[tel:123](tel:123)\n";
    expect(roundTrip(tel)).toBe(tel);
  });

  it("keeps bare https literals byte-canonical (resourceLink must not regress them)", () => {
    const md = "see https://example.com now\n";
    expect(roundTrip(md)).toBe(md);
    expect(analyzeMarkdown(md).canonical).toBe(true);
  });

  it("never emits `---` as a document's first line (V5 frontmatter guard)", () => {
    // A doc-leading `---` re-parses as a frontmatter fence and can silently
    // absorb following prose into YAML. Leading hrs canonicalize to `***`;
    // mid-document hrs keep the `---` rule.
    expect(roundTrip("---\n")).toBe("***\n");
    expect(roundTrip("***\n***\n")).toBe("***\n\n---\n");
    expect(roundTrip("***\n\nkey: value\n\n***\n")).toBe("***\n\nkey: value\n\n---\n");
    expect(roundTrip("x\n\n---\n")).toBe("x\n\n---\n");
    // Real frontmatter still serializes its own fences at byte 0.
    const fm = "---\ntitle: x\n---\n\nbody\n";
    expect(roundTrip(fm)).toBe(fm);
  });

  it("omits src from url-less media (V3 — a bare attr fails the vocabulary scan)", () => {
    expect(roundTrip("<video />\n")).toBe("<video />\n");
    expect(analyzeMarkdown("<video />\n").canonical).toBe(true);
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [{ children: [{ text: "" }], type: "file" }],
    });
    expect(out).toBe("<file />\n");
  });

  it("pads ragged tables into a pass-1 fixpoint (V4)", () => {
    // Short rows become REAL empty cells at deserialize, so the first pass
    // already emits the stable ZWSP-cell form instead of reaching it on pass 3.
    const out = roundTrip("| a | b |\n| - | - |\n| 1 |\n");
    expect(out).toBe("| a | b |\n| - | - |\n| 1 | ​ |\n");
    expect(roundTrip(out)).toBe(out);
  });

  it("persists table column alignment across the round-trip", () => {
    // Plate's default table rule drops mdast `align`, which would silently
    // strip `:-:` delimiters on a rich save; the align array rides on the
    // Slate table node instead.
    const out = roundTrip("| a |\n|:-:|\n| 1 |\n");
    expect(out).toBe("|  a  |\n| :-: |\n|  1  |\n");
    expect(roundTrip(out)).toBe(out);
    expect(analyzeMarkdown("| a |\n|:-:|\n| 1 |\n").richSafe).toBe(true);
  });

  it("keeps empty todos checkable via the ZWSP placeholder", () => {
    // gfm's serializer inserts the checkbox after the bullet's following
    // space, which empty content never produces — without the placeholder an
    // empty todo saves as a bare `-`, silently dropping the checkbox.
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [
        { checked: false, children: [{ text: "" }], indent: 1, listStyleType: "todo", type: "p" },
        { checked: true, children: [{ text: "" }], indent: 1, listStyleType: "todo", type: "p" },
      ],
    });
    expect(out).toBe("- [ ] ​\n- [x] ​\n");
    expect(roundTrip(out)).toBe(out); // and it re-parses as an empty todo
    expect(analyzeMarkdown(out).canonical).toBe(true);
  });
});

describe("gate API", () => {
  it("parseMarkdown feeds the same bytes the gate serializes (seed-path parity)", () => {
    const md = "# Hi\n\n- one\n- two\n\n> [!NOTE]\n> alert\n";
    const parsed = parseMarkdown(md);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = serializeMd(createSlateEditor({ plugins: BASE_KIT }), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: parsed.value,
    });
    expect(out).toBe(roundTrip(md));
  });

  it("parseMarkdown surfaces the raw reason instead of a degraded value", () => {
    const parsed = parseMarkdown("<Steps>x</Step>\n");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason.kind).toBe("parse-error");
  });

  it("roundTrip throws typed errors carrying the reason", () => {
    try {
      roundTrip("<Foo>broken</Bar>\n");
      expect.unreachable("roundTrip must throw on parse failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ParseFailedError);
      if (error instanceof ParseFailedError) {
        expect(error.reason.kind).toBe("parse-error");
        expect(describeRawReason(error.reason)).toMatch(/^Parse error at line 1/);
      }
    }
  });

  it("classifies conversion stack overflow as Raw instead of throwing (V1)", () => {
    // micromark parses ~3000-deep nesting fine, but the mdast→Slate→stringify
    // recursion overflows around depth ~1250 — that RangeError must surface
    // as a DocAnalysis, and the badge and Format must agree on it.
    const deep = "> ".repeat(3000) + "x\n";
    const analysis = analyzeMarkdown(deep);
    expect(analysis.richSafe).toBe(false);
    expect(analysis.canonical).toBe(false);
    expect(analysis.rawReason).toEqual({
      kind: "parse-error",
      line: null,
      message: "Document nests too deeply to convert",
    });
    expect(() => roundTrip(deep)).toThrow(ParseFailedError);
  });

  it("describes the reason for the mode badge, with and without a line", () => {
    expect(
      describeRawReason({ kind: "parse-error", line: 4, message: "Unexpected closing tag" }),
    ).toBe("Parse error at line 4: Unexpected closing tag");
    expect(describeRawReason({ kind: "parse-error", line: null, message: "Nope" })).toBe(
      "Parse error: Nope",
    );
  });
});

// Inteligir also accepts payload lines prefixed (`type: warning` / `level:
// high`); the spelling is remembered on the node, so the round trip is
// byte-exact — and an unknown kind is a plain code block.
const variantsOf = (md: string): string => {
  const parsed = parseMarkdown(md);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return "";
  return JSON.stringify(parsed.value);
};

describe("callout payload forms (prefixed `type:`/`level:` + unknown kinds)", () => {
  it("round-trips the prefixed spellings byte-exact", () => {
    for (const md of [
      "```inteligir-callout\ntype: warning\nCareful.\n```\n",
      "```inteligir-callout\ntype: priority\nlevel: high\nShip it.\n```\n",
    ]) {
      expect(roundTrip(md)).toBe(md);
    }
  });

  it("prefixed and bare forms parse to the same callout variant", () => {
    const bare = variantsOf("```inteligir-callout\nwarning\nCareful.\n```\n");
    const prefixed = variantsOf("```inteligir-callout\ntype: warning\nCareful.\n```\n");
    expect(bare).toContain('"variant":"warning"');
    expect(prefixed).toContain('"variant":"warning"');
  });

  it("an unknown kind stays a plain code block, byte-stable", () => {
    const md = "```inteligir-callout\nshiny\nbody\n```\n";
    expect(roundTrip(md)).toBe(md);
    expect(variantsOf(md)).not.toContain('"type":"callout"');
  });

  it("a priority level line under a non-priority kind is body text", () => {
    expect(roundTrip("```inteligir-callout\ntype: info\nlevel: high\n```\n")).toBe(
      "```inteligir-callout\ntype: info\nlevel: high\n```\n",
    );
  });
});
