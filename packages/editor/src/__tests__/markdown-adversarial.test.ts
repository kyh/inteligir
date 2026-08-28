import { describe, expect, it } from "vitest";

import { analyzeMarkdown, roundTrip } from "@repo/editor/markdown/markdown-doc";

// Adversarial round-trip hunt — a property harness over the WP1 gate API.
// Deterministic (fixed-seed fuzz corpus); every input must uphold:
//
//   (a) never-throw     analyzeMarkdown classifies EVERY string — parse/scan/
//                       convert failures must surface as DocAnalysis, not as
//                       uncaught exceptions (incl. RangeError on deep nesting).
//   (b) canonical-byte  canonical ⇒ roundTrip(md) succeeds, agrees with md
//                       modulo trailing whitespace, and is byte-identical when
//                       md already ends in exactly one "\n" (whitespace-only
//                       docs exempt: they canonicalize to "").
//   (c) fixpoint        when roundTrip(md) succeeds, its output is stable:
//                       roundTrip(out) === out — and in particular out must
//                       RE-PARSE (Format must never produce a Raw file).
//   (d) content         canonical ⇒ letters(out) === letters(md) (no
//                       alphanumeric content invented or lost).
//   (e) gate-agreement  analyzeMarkdown.rawReason === null ⟺ roundTrip does
//                       not throw (the badge and the Format action agree).
//
// A failure here is a serialization-pipeline bug: fix the pipeline (or, for a
// conscious canonical-form revision, document it) — never relax the invariant.

type ViolationKind =
  | "a-analyze-throw"
  | "b-canonical-not-byte-stable"
  | "c-not-idempotent"
  | "c-output-does-not-reparse"
  | "d-canonical-content-loss"
  | "e-gate-roundtrip-disagree";

/** `signature` identifies the ROOT failure (dedupe key across inputs);
 * `detail` carries the per-input evidence. */
type Violation = { kind: ViolationKind; input: string; detail: string; signature: string };

const letters = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

const anonymize = (s: string) => clip(s.replace(/\d+/g, "#"), 90);

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 20), i + 20));
  return `first diff at ${i}: ${ctx(a)} vs ${ctx(b)}`;
}

/** Run every invariant against one input; return the violations it produces. */
function hunt(md: string): Violation[] {
  const found: Violation[] = [];

  let analysis: ReturnType<typeof analyzeMarkdown>;
  try {
    analysis = analyzeMarkdown(md);
  } catch (error) {
    found.push({
      detail: clip(String(error)),
      input: md,
      kind: "a-analyze-throw",
      signature: `a|${anonymize(String(error))}`,
    });
    return found;
  }

  let out: string | null = null;
  let rtError: string | null = null;
  try {
    out = roundTrip(md);
  } catch (error) {
    rtError = String(error);
  }

  // (e) the mode badge and the Format action must agree.
  if (analysis.rawReason === null && out === null) {
    found.push({
      detail: `rawReason null but roundTrip threw: ${clip(String(rtError))}`,
      input: md,
      kind: "e-gate-roundtrip-disagree",
      signature: `e|throw|${anonymize(String(rtError))}`,
    });
  }
  if (analysis.rawReason !== null && out !== null) {
    found.push({
      detail: `rawReason ${analysis.rawReason.kind} but roundTrip succeeded`,
      input: md,
      kind: "e-gate-roundtrip-disagree",
      signature: `e|ok|${analysis.rawReason.kind}`,
    });
  }

  // (c) roundTrip output is the pipeline's canonical form — it must re-parse
  // and be a fixpoint, or the one-time Format action corrupts the file.
  if (out !== null) {
    try {
      const out2 = roundTrip(out);
      if (out2 !== out) {
        let i = 0;
        while (i < out.length && i < out2.length && out[i] === out2[i]) i++;
        found.push({
          detail: `pass1=${clip(JSON.stringify(out))} pass2=${clip(JSON.stringify(out2))}; ${firstDiff(out, out2)}`,
          input: md,
          kind: "c-not-idempotent",
          signature: `c|drift|${JSON.stringify([out[i] ?? "", out2[i] ?? ""])}`,
        });
      }
    } catch (error) {
      found.push({
        detail: `roundTrip output ${clip(JSON.stringify(out))} failed second pass: ${clip(String(error))}`,
        input: md,
        kind: "c-output-does-not-reparse",
        signature: `c|reparse|${anonymize(String(error))}`,
      });
    }
  }

  // (b) + (d) canonical must mean byte-stable and content-preserving.
  if (analysis.canonical) {
    if (out === null) {
      found.push({
        detail: `canonical but roundTrip threw: ${clip(String(rtError))}`,
        input: md,
        kind: "b-canonical-not-byte-stable",
        signature: `b|throw|${anonymize(String(rtError))}`,
      });
    } else {
      if (out.trimEnd() !== md.trimEnd()) {
        found.push({
          detail: firstDiff(md.trimEnd(), out.trimEnd()),
          input: md,
          kind: "b-canonical-not-byte-stable",
          signature: "b|trimmed-drift",
        });
      } else if (md.trim() !== "" && md === `${md.trimEnd()}\n` && out !== md) {
        // A canonical file already ending in exactly one newline must not
        // change AT ALL on save.
        found.push({
          detail: `strict byte drift: ${firstDiff(md, out)}`,
          input: md,
          kind: "b-canonical-not-byte-stable",
          signature: "b|strict-drift",
        });
      }
      if (letters(out) !== letters(md)) {
        found.push({
          detail: `letters(in)=${clip(letters(md), 60)} letters(out)=${clip(letters(out), 60)}`,
          input: md,
          kind: "d-canonical-content-loss",
          signature: "d|letters",
        });
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Shrinking — greedy line- then chunk-removal keeping the same violation kind,
// so failures report a minimal repro instead of a 3KB fuzz document.
// ---------------------------------------------------------------------------

function shrink(input: string, target: Violation, budget: number): string {
  if (input.length > 4000) return input; // constructed pathological inputs stay as-is
  let current = input;
  let remaining = budget;
  // Same SIGNATURE, not just same kind — greedy removal must not slide from
  // one root cause into a different (smaller) bug and mislabel the repro.
  const violates = (candidate: string): boolean => {
    if (remaining <= 0) return false;
    remaining -= 1;
    return hunt(candidate).some((v) => v.signature === target.signature);
  };
  let improved = true;
  while (improved) {
    improved = false;
    const lines = current.split("\n");
    if (lines.length > 1) {
      for (let i = 0; i < lines.length; i++) {
        const candidate = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
        if (candidate !== current && violates(candidate)) {
          current = candidate;
          improved = true;
          break;
        }
      }
      if (improved) continue;
    }
    for (
      let chunk = Math.max(1, Math.floor(current.length / 2));
      chunk >= 1;
      chunk = Math.floor(chunk / 2)
    ) {
      let removed = false;
      for (let start = 0; start + chunk <= current.length; start += chunk) {
        const candidate = current.slice(0, start) + current.slice(start + chunk);
        if (violates(candidate)) {
          current = candidate;
          removed = true;
          improved = true;
          break;
        }
      }
      if (removed || chunk === 1) break;
    }
    if (remaining <= 0) break;
  }
  return current;
}

function report(cases: Iterable<readonly [string, string]>): string[] {
  const bySignature = new Map<string, Violation & { name: string }>();
  for (const [name, md] of cases) {
    for (const violation of hunt(md)) {
      if (!bySignature.has(violation.signature)) {
        bySignature.set(violation.signature, { ...violation, name });
      }
    }
  }
  const lines = new Set<string>();
  let shrunk = 0;
  for (const violation of bySignature.values()) {
    const minimal = shrunk < 20 ? shrink(violation.input, violation, 300) : violation.input;
    shrunk += 1;
    // Re-hunt the minimized input so the evidence matches the shown repro.
    const fresh = hunt(minimal).find((v) => v.signature === violation.signature);
    const detail = fresh ? fresh.detail : violation.detail;
    lines.add(
      `${violation.kind} [${violation.name}] input=${JSON.stringify(clip(minimal, 200))} :: ${detail}`,
    );
  }
  return [...lines].toSorted();
}

// ---------------------------------------------------------------------------
// Handcrafted corpus — every construct class the pipeline claims to handle,
// bent until it creaks. Raw-classified inputs belong here too: they must
// classify (a) and agree (e), never mangle.
// ---------------------------------------------------------------------------

const CORPUS = {
  // dollars / math
  "dollar-adjacent": "$5-$6 and \\$7 and $$ at EOL $$\n",
  "dollar-run-alone": "$$$$\n",
  "dollar-inline-empty": "a $$$$ b\n",
  "math-display": "$$\nE = mc^2\n$$\n",
  "math-display-unclosed": "$$\nx\n",
  "math-inline-pipe": "$$a|b$$\n",
  "math-inline-eol": "before $$x+y$$\n",
  "math-meta-line": "$$latex\nx\n$$\n",

  // emphasis / marks
  "em-strong-mixed": "***a*** and **_b_** and _**c**_\n",
  "single-tilde-strike": "~x~ mid ~~y~~\n",
  "emphasis-wrapping-wiki": "_[[a]]_ and **[[b]]** tail\n",
  "underscore-in-word": "snake_case_name stays\n",

  // links / autolinks
  "bare-https-literal": "see https://example.com now\n",
  "bare-email-literal": "contact a@b.cd today\n",
  "email-in-heading": "# mail a@b.cd\n",
  "email-in-quote": "> a@b.cd\n",
  "email-in-table": "| a@b.cd |\n| ------ |\n| x      |\n",
  "email-in-toggle": "<toggle>\n  a@b.cd\n</toggle>\n",
  "email-in-alert": "> [!NOTE] mail a@b.cd ok\n",
  "mailto-explicit": "[a@b.cd](mailto:a@b.cd)\n",
  "url-equals-text": "[https://example.com](https://example.com)\n",
  "www-literal": "see www.example.com now\n",
  "url-parens": "see https://x.cd/a(1) ok\n",
  "link-angle-destination": "[a](<b c>)\n",
  "link-title": '[a](u "t")\n',
  "link-empty-url": "[a]()\n",
  "image-title": '![a](u "t")\n',
  "reference-link": "[a][b]\n\n[b]: /url\n",
  "reference-image": "![a][b]\n\n[b]: /u\n",
  "definition-only": "[b]: /url\n",
  footnote: "text[^1]\n\n[^1]: the note\n",
  "footnote-with-wiki": "x[^1]\n\n[^1]: see [[x]]\n",

  // wiki links / embeds
  "wiki-pipe-alias": "[[a|b]] and [[a#b|c]]\n",
  "wiki-only-pipe": "[[|]]\n",
  "wiki-space-body": "[[ ]]\n",
  "wiki-trailing-space": "[[a ]]\n",
  "wiki-unicode-body": "[[\u{1F389} עברית]]\n",
  "wiki-url-body": "[[https://x.cd]]\n",
  "wiki-backslash-body": "[[a\\b]]\n",
  "wiki-adjacent": "[[a]][[b]]\n",
  "wiki-then-parens": "[[a]](b)\n",
  "wiki-escaped-open": "\\[[x]]\n",
  "wiki-double-bang": "!![[a]]\n",
  "wiki-in-code-span": "`[[a|b]]` stays code\n",
  "wiki-in-fence": "```\n[[a|b]] ]] |\n```\n",
  "wiki-in-table-escaped-pipe": "| [[a\\|b]] |\n| -------- |\n| x        |\n",
  "embed-in-list": "- ![[img.png|300]]\n",
  "wiki-unclosed": "[[a\n",
  "wiki-single-close": "[[a]b]]\n",

  // tables
  "table-alignment": "| a | b | c |\n|:- | -:|:-:|\n| 1 | 2 | 3 |\n",
  "table-ragged-body-short": "| a | b |\n| - | - |\n| 1 |\n",
  "table-ragged-body-long": "| a |\n| - |\n| 1 | 2 |\n",
  "table-ragged-header": "| a |\n| - | - |\n",
  "table-empty-cells": "| a |  |\n| - | - |\n|   | b |\n",
  "table-escaped-pipe": "| a\\|b |\n| ---- |\n| c    |\n",
  "table-code-span-pipe": "| `a|b` |\n| ----- |\n| x     |\n",
  "table-inline-jsx":
    '| <date value="2026-01-01" /> |\n| --------------------------- |\n| y                           |\n',

  // blockquotes / alerts
  "alert-minimal": "> [!NOTE] x\n",
  "alert-no-trailing-newline": "> [!NOTE] x",
  "alert-multiline": "> [!TIP]\n> first\n> second\n",
  "alert-with-fence": "> [!NOTE]\n>\n> ```js\n> code()\n> ```\n",
  "alert-with-list": "> [!WARNING]\n>\n> - a\n> - b\n",
  "alert-nested-quote": "> [!NOTE]\n>\n> > inner\n",
  "alert-inside-quote": "> > [!NOTE] inner\n",
  "alert-bold-fake": "> **[!NOTE]** x\n",
  "alert-lowercase-fake": "> [!note] x\n",
  "alert-inside-toggle": "<toggle>\n  > [!NOTE]\n  > hey\n</toggle>\n",
  "alert-wiki-math": "> [!TIP] see [[x#y|z]] and $$a+b$$\n",
  "alert-hard-break": "> [!NOTE] a\\\n> b\n",
  "alert-list-first-child": "> - [!NOTE] fake\n",
  "alert-caution-important": "> [!CAUTION] c\n\n> [!IMPORTANT] i\n",
  "lazy-continuation": "> a\nb\n",

  // vocabulary JSX
  "toggle-empty-attr": '<toggle t="">\n  x\n</toggle>\n',
  "toggle-attr-quote-entities": '<toggle t="say &#x22;hi&#x22;">\n  x\n</toggle>\n',
  "toggle-attr-unicode": '<toggle t="héllo \u{1F389} عرب">\n  x\n</toggle>\n',
  "toggle-attr-newline": '<toggle t="a\nb">\n  x\n</toggle>\n',
  "toggle-attr-braces-string": '<toggle t="{notexpr}">\n  x\n</toggle>\n',
  "toggle-self-closing": "<toggle />\n",
  "callout-empty": "<callout>\n</callout>\n",
  "callout-unknown-string-attr": '<callout foo="bar">\n  x\n</callout>\n',
  "callout-user-id-attr": '<callout id="keep">\n  x\n</callout>\n',
  "video-bare": "<video />\n",
  "file-bare": "<file />\n",
  "media-embed-bare": "<media_embed />\n",
  "video-empty-src": '<video src="" />\n',
  "video-id-attr": '<video id="a" src="u" />\n',
  "column-group-minimal": "<column_group>\n  <column>\n    a\n  </column>\n</column_group>\n",
  "table-inside-toggle": "<toggle>\n  | a |\n  | - |\n  | b |\n</toggle>\n",
  "date-with-children": '<date value="2026-01-01">label</date> x\n',
  "jsx-indented": "  <toggle>\n  x\n  </toggle>\n",

  // NOT vocabulary — must classify Raw, never throw, never mangle
  "unknown-component": "<Steps>\n  x\n</Steps>\n",
  "lowercase-div": "<Div>x</Div>\n",
  "web-component-tag": "a <x-y>z</x-y> b\n",
  fragment: "<>\nx\n</>\n",
  "expression-flow": "{count + 1}\n",
  "expression-inline": "a {expr} b\n",
  "html-comment": "<!-- hidden -->\n",
  "autolink-angle": "<https://example.com>\n",
  "autolink-angle-email": "<a@b.cd>\n",
  "lt-digit": "returns in <50ms\n",
  "lt-space": "a < b\n",
  "unclosed-tag": "<toggle>\nnever closed\n",
  "esm-import-line": 'import x from "y"\n\nprose\n',
  "toggle-inline-position": "before <toggle>x</toggle> after\n",
  "spread-attr": "<toggle {...props}>\n  x\n</toggle>\n",
  "expression-attr": "<toggle open={true}>\n  x\n</toggle>\n",
  "bare-attr": "<callout draft>\n  x\n</callout>\n",

  // frontmatter
  "frontmatter-empty": "---\n---\n",
  "frontmatter-crlf": "---\r\na: 1\r\n---\r\nbody\r\n",
  "frontmatter-yaml-hash": "---\n# comment\nkey: v\n---\n\nbody\n",
  "frontmatter-four-dashes": "----\n",
  "frontmatter-two-blocks": "---\na: 1\n---\n\n---\nb: 2\n---\n",
  "frontmatter-trailing-spaces-inside": "---\nkey: v   \n---\n",
  "frontmatter-unicode": "---\ntitle: héllo — \u{1F389}\n---\n",
  "frontmatter-after-blank": "\n---\na: 1\n---\n",

  // whitespace / line endings / bytes
  "crlf-mixed": "a\r\nb\nc\r\n",
  "cr-only-line-ending": "a\rb\n",
  "trailing-space-runs": "a \nb  \nc   \n",
  "hard-break-eof": "a\\\n",
  "tab-inline": "a\tb\n",
  "tab-indented-code": "\tindented code\n",
  "nbsp-only": " ",
  "nbsp-in-text": "a b\n",
  "nbsp-list-marker": "- item\n",
  "vertical-tab-only": "\v",
  "form-feed-only": "\f",
  "ideographic-space-only": "　",
  "line-separator-only": " ",
  "bom-only": "﻿",
  "bom-then-heading": "﻿# Hi\n",
  "nul-byte": "a b\n",
  "blank-run-middle": "a\n\n\n\n\nb\n",
  "no-trailing-newline": "# Hi",
  "many-trailing-newlines": "# Hi\n\n\n",
  "spaces-only": "   ",
  empty: "",

  // unicode content
  "zwj-emoji-family": "family \u{1F469}‍\u{1F469}‍\u{1F467}‍\u{1F466} here\n",
  "rtl-mixed": "עברית and العربية mixed\n",
  "combining-marks-nfd": "café nfd\n",
  "zero-width-space": "a​b\n",
  "bidi-override": "a‮b‬c\n",
  "lone-surrogate": "a\uD800b\n",

  // structure edges
  "heading-empty": "#\n",
  "heading-trailing-hashes": "# a #\n",
  "heading-seven-hashes": "####### seven\n",
  "setext-heading": "Title\n=====\n\nbody\n",
  "ordered-start-zero": "0. a\n",
  "ordered-padded": "003. a\n",
  "ordered-paren-marker": "1) a\n",
  "loose-list": "- a\n\n- b\n",
  "empty-todo": "- [ ]\n",
  "todo-capital-x": "- [X] done\n",
  "list-item-only-fence": "- ```\n  x\n  ```\n",
  "quote-with-fence": "> ```\n> x\n> ```\n",
  "tilde-fence": "~~~js\ncode\n~~~\n",
  "fence-unclosed": "```js\ncode\n",
  "fence-growth": "````\n```\ninner\n```\n````\n",
  "fence-close-indented": "```\nx\n ```\n",
  "hr-variants": "***\n\n___\n\n- - -\n",
  "two-leading-hrs": "***\n\n***\n",
  "hr-prose-hr": "***\n\nkey: value\n\n***\n",
  "empty-list-item": "-\n",
  "hr-then-empty-item": "___\n\n-\n",
  entities: "&nbsp;&mdash;&amp;\n",
} satisfies Record<string, string>;

// ---------------------------------------------------------------------------
// Seeded fuzz — deterministic composition of nasty fragments + byte mutations.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAGMENTS: string[] = Object.values(CORPUS).filter(
  (f) => f.trim() !== "" && !f.startsWith("---") && !f.startsWith("﻿") && !f.startsWith("\n"),
);
const FRONTMATTERS = ["---\na: 1\n---", "---\n---", "---\ntitle: héllo — ok\nlist:\n  - 1\n---"];
const PUNCT = "[](){}<>|!#$*_~`\\-+.:@\"' \n";

function fuzzDocs(count: number): [string, string][] {
  const rand = mulberry32(0xc0ffee);
  const int = (n: number) => Math.floor(rand() * n);
  const pick = <T>(xs: readonly T[]): T | undefined => xs[int(xs.length)];
  const docs: [string, string][] = [];
  for (let i = 0; i < count; i++) {
    let doc: string;
    if (i % 5 === 4) {
      // pure punctuation soup (short) — parser corner probing
      const len = 1 + int(40);
      let s = "";
      for (let j = 0; j < len; j++) s += PUNCT[int(PUNCT.length)] ?? "";
      doc = s;
    } else {
      const parts: string[] = [];
      if (rand() < 0.25) parts.push(pick(FRONTMATTERS) ?? "");
      const n = 2 + int(7);
      for (let j = 0; j < n; j++) parts.push((pick(FRAGMENTS) ?? "").trimEnd());
      doc = parts.join("\n\n") + "\n";
      // mutations
      if (rand() < 0.2 && !doc.includes("\r")) doc = doc.replaceAll("\n", "\r\n");
      if (rand() < 0.2) {
        const lines = doc.split("\n");
        const k = int(lines.length);
        lines[k] = `${lines[k] ?? ""}  `;
        doc = lines.join("\n");
      }
      if (rand() < 0.15) doc = doc.replace(" ", "\t");
      if (rand() < 0.15) {
        const at = int(doc.length);
        doc = `${doc.slice(0, at)}​${doc.slice(at)}`;
      }
      if (rand() < 0.1) doc = doc.trimEnd();
      if (rand() < 0.05) doc = `﻿${doc}`;
    }
    docs.push([`fuzz-${i}`, doc]);
  }
  return docs;
}

// ---------------------------------------------------------------------------

describe("adversarial round-trip hunt", () => {
  it("handcrafted corpus upholds the gate invariants", { timeout: 90_000 }, () => {
    expect(report(Object.entries(CORPUS))).toEqual([]);
  });

  it("seeded fuzz corpus upholds the gate invariants", { timeout: 120_000 }, () => {
    expect(report(fuzzDocs(140))).toEqual([]);
  });

  it("pathological nesting never escapes analyzeMarkdown", { timeout: 120_000 }, () => {
    // Depth 3000 sits inside the conversion-overflow band: micromark parses it
    // fine (its own recursion only overflows around depth ~6-8k, where
    // parseMdast catches the RangeError and classifies Raw), but the mdast →
    // Slate → serialize recursion blows the stack at ~1250 (Node defaults) —
    // and nothing catches THAT. Nested lists hit the same recursion at ~560;
    // the blockquote case stands in for the class because its input is tiny
    // (6KB vs megabytes of list indentation).
    const deep: [string, string][] = [
      ["blockquote-depth-3000", "> ".repeat(3000) + "x\n"],
      ["toggle-depth-300", "<toggle>\n".repeat(300) + "x\n" + "</toggle>\n".repeat(300)],
      [
        "list-depth-300",
        Array.from({ length: 300 }, (_, i) => `${"  ".repeat(i)}- x`).join("\n") + "\n",
      ],
      ["emphasis-run-2000", "*".repeat(2000) + "x\n"],
      ["bracket-run-2000", "[".repeat(2000) + "x\n"],
      ["long-line-200kb", "word ".repeat(40_000) + "\n"],
    ];
    expect(report(deep)).toEqual([]);
  });
});
