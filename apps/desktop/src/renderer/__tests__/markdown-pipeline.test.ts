import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { BASE_KIT } from "@renderer/editor/kits/base-kit";
import {
  MD_STRINGIFY,
  ParseFailedError,
  analyzeMarkdown,
  describeRawReason,
  parseMarkdown,
  roundTrip,
} from "@renderer/editor/markdown/markdown-doc";
import { parseMdast } from "@repo/notes/markdown/parse";
import { parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";
import { scanVocabulary } from "@repo/notes/markdown/vocabulary";

// In-tree translations of the scratchpad probe scenarios (rt/probe1-6) that
// aren't already pinned by the fixture matrix: the failure modes the owned
// parse + vocabulary scan exist to kill, and the unit surface of the wiki
// tokenizer / body parser.

describe("owned parse (probe1/2/3 translations)", () => {
  it("throws real errors instead of deserializeMd's silent degradation", () => {
    // Each of these produced a mangled, non-idempotent model under
    // deserializeMd (probe1); under the owned parse they are honest failures.
    const parseErrors = [
      "returns in <50ms sometimes\n",
      "see <https://example.com> now\n",
      "<Foo>\n\nnever closed\n",
      "{unclosed brace\n",
      "hello\n\n<!-- a comment -->\n\nworld\n",
    ];
    for (const md of parseErrors) {
      const result = parseMdast(md);
      expect(result.ok, md).toBe(false);
      if (result.ok) continue;
      expect(result.failure.message.length).toBeGreaterThan(0);
    }
    // Positioned errors carry the line for the badge tooltip.
    const positioned = parseMdast("first\n\nreturns in <50ms sometimes\n");
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
    // expression — the vocabulary scan routes it to Raw instead of a crash.
    const analysis = analyzeMarkdown("config { noServer: true } here\n");
    expect(analysis.rawReason?.kind).toBe("expression");
  });

  it("keeps `import X from 'x'` as prose (no mdxjsEsm under agnostic MDX)", () => {
    const md = "import X from 'x'\n\nhello\n";
    expect(analyzeMarkdown(md).canonical).toBe(true);
    expect(roundTrip(md)).toBe(md);
  });
});

const scan = (md: string) => {
  const parsed = parseMdast(md);
  expect(parsed.ok).toBe(true);
  return parsed.ok ? scanVocabulary(parsed.root) : null;
};

describe("vocabulary scan (probe1 unknown-JSX hole)", () => {
  it("rejects unknown components that would pass the letters() heuristic", () => {
    // `<Foo bar="1">text</Foo>` degrades to escaped text whose letters() equals
    // the source — without the scan, isRichSafe would wave it into Rich mode
    // and the first edit would mangle the component into `\<Foo>` prose.
    expect(scan('<Foo bar="1">text body</Foo>\n')).toEqual({ kind: "unknown-jsx", name: "Foo" });
  });

  it("rejects lowercase paired tags — fixed vocabulary means fixed", () => {
    expect(scan('<div align="center">x</div>\n')).toEqual({ kind: "unknown-jsx", name: "div" });
    expect(scan("press <kbd>K</kbd> now\n")).toEqual({ kind: "unknown-jsx", name: "kbd" });
  });

  it("rejects fragments", () => {
    expect(scan("<>\nfragment\n</>\n")).toEqual({ kind: "unknown-jsx", name: "<>" });
  });

  it("rejects non-string attribute forms on allowed tags", () => {
    expect(
      scan("<column_group>\n  <column width={50}>\n    x\n  </column>\n</column_group>\n"),
    ).toEqual({
      attr: "width",
      kind: "jsx-attr",
      name: "column",
    });
    expect(scan("<callout draft>\n  x\n</callout>\n")).toEqual({
      attr: "draft",
      kind: "jsx-attr",
      name: "callout",
    });
    expect(scan("<callout {...props}>\n  x\n</callout>\n")).toEqual({
      attr: "{...spread}",
      kind: "jsx-attr",
      name: "callout",
    });
  });

  it("permits unknown attr NAMES on allowed flow tags (string props round-trip)", () => {
    expect(scan('<callout variant="info" custom="yes">\n  x\n</callout>\n')).toBeNull();
  });

  it("rejects unknown attr names on <date> (Plate's rule keeps only `value`)", () => {
    // Unlike the flow tags, date's deserialize DROPS everything but `value` —
    // waving `foo` through would silently delete it on the first rich save.
    expect(scan('Meet <date value="2026-07-01" foo="x" /> ok\n')).toEqual({
      attr: "foo",
      kind: "jsx-attr",
      name: "date",
    });
  });

  it("allows date in text AND flow position", () => {
    expect(scan('Meet on <date value="2026-07-01" /> at noon.\n')).toBeNull();
    // A chip-only paragraph serializes to a line-filling `<date />`, which
    // re-parses as flow — md-rules wraps it back into a paragraph, so the
    // scan admits it (fixture: canonical/date-only-paragraph.md).
    expect(scan('<date value="2026-07-01" />\n')).toBeNull();
  });

  it("passes the whole fixed vocabulary", () => {
    const md = [
      '<callout variant="info">',
      "  x",
      "</callout>",
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
    ].join("\n");
    expect(scan(md)).toBeNull();
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

  it("drops empty segments", () => {
    expect(parseWikiBody("a|")).toEqual({ target: "a" });
    expect(parseWikiBody("a#")).toEqual({ target: "a" });
    expect(parseWikiBody("a#|x")).toEqual({ alias: "x", target: "a" });
  });

  it("only the first pipe splits the alias", () => {
    expect(parseWikiBody("a|b|c")).toEqual({ alias: "b|c", target: "a" });
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
    expect(out).toContain('<callout variant="info">');
    expect(out).toContain('<video src="https://y.tb/1" />');
    expect(out).toContain('<file src="https://e.com/a.pdf" />');
    expect(out).toContain("<toggle>");
  });

  it("emits bare emails as literal bytes, never <angle> autolinks (V2)", () => {
    // gfm email literals used to reach mdast-util-to-markdown's
    // formatLinkAsAutolink and come back as `<a@b.cd>` — unparseable under
    // MDX, so a richSafe:true file was corrupted by its first save.
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
    // Plate's default table rule dropped mdast `align`, so `:-:` delimiters
    // were silently stripped by a rich save. The align array now rides on the
    // Slate table node.
    const out = roundTrip("| a |\n|:-:|\n| 1 |\n");
    expect(out).toBe("|  a  |\n| :-: |\n|  1  |\n");
    expect(roundTrip(out)).toBe(out);
    expect(analyzeMarkdown("| a |\n|:-:|\n| 1 |\n").richSafe).toBe(true);
  });

  it("keeps empty todos checkable via the ZWSP placeholder", () => {
    // gfm's serializer inserts the checkbox after the bullet's following
    // space, which empty content never produces — an empty todo used to save
    // as a bare `-`, silently dropping the checkbox.
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

  it("keeps transient AI/suggestion text out of serialization", () => {
    // disallowedNodes drops the still-pending (not yet accepted) AI text from
    // saves entirely; accepting removes the mark, and only then does the text
    // reach the file.
    const out = serializeMd(editor(), {
      remarkStringifyOptions: MD_STRINGIFY,
      value: [
        {
          children: [{ text: "kept" }, { ai: true, text: " pending" }],
          type: "p",
        },
      ],
    });
    expect(out).toBe("kept\n");
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
    const parsed = parseMarkdown("<Steps>x</Steps>\n");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason.kind).toBe("unknown-jsx");
  });

  it("roundTrip throws typed errors carrying the reason", () => {
    try {
      roundTrip("returns in <50ms\n");
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

  it("describes every reason kind for the mode badge", () => {
    expect(describeRawReason({ kind: "unknown-jsx", name: "Steps" })).toBe(
      "Contains unsupported element <Steps>",
    );
    expect(describeRawReason({ attr: "draft", kind: "jsx-attr", name: "callout" })).toBe(
      "<callout> has an unsupported attribute (draft)",
    );
    expect(describeRawReason({ kind: "expression" })).toBe("Contains a {…} expression");
  });
});
