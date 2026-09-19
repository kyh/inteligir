import { describe, expect, it } from "vitest";

import { analyzeMarkdown, roundTrip } from "@repo/editor/markdown/markdown-doc";

// Invariants: (a) analyzeMarkdown never throws; (b) canonical ⇒ roundTrip is
// byte-stable modulo trailing whitespace; (c) roundTrip output re-parses and is a
// fixpoint; (d) canonical ⇒ no letters invented or lost; (e) rawReason === null ⟺
// roundTrip does not throw. Fix the pipeline, never relax an invariant.

type ViolationKind =
  | "a-analyze-throw"
  | "b-canonical-not-byte-stable"
  | "c-not-idempotent"
  | "c-output-does-not-reparse"
  | "d-canonical-content-loss"
  | "e-gate-roundtrip-disagree";

// `signature` is the dedupe key across inputs
interface Violation {
  kind: ViolationKind;
  input: string;
  detail: string;
  signature: string;
}

const letters = (s: string) => s.replaceAll(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

const anonymize = (s: string) => clip(s.replaceAll(/\d+/gu, "#"), 90);

const firstDiff = (a: string, b: string): string => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i += 1;
  }
  const ctx = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 20), i + 20));
  return `first diff at ${i}: ${ctx(a)} vs ${ctx(b)}`;
};

type Analysis = ReturnType<typeof analyzeMarkdown>;

// (e): the rawReason gate and roundTrip must agree on whether the doc is convertible
const gateViolations = (
  md: string,
  analysis: Analysis,
  out: string | null,
  rtError: string | null,
): Violation[] => {
  const found: Violation[] = [];
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
  return found;
};

// (c): a second pass over the output re-parses and lands on the same bytes
const idempotenceViolations = (md: string, out: string): Violation[] => {
  const found: Violation[] = [];
  try {
    const out2 = roundTrip(out);
    if (out2 !== out) {
      let i = 0;
      while (i < out.length && i < out2.length && out[i] === out2[i]) {
        i += 1;
      }
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
  return found;
};

// (b) and (d): a canonical doc round-trips byte-stably and invents or loses no letters
const canonicalViolations = (
  md: string,
  out: string | null,
  rtError: string | null,
): Violation[] => {
  const found: Violation[] = [];
  if (out === null) {
    found.push({
      detail: `canonical but roundTrip threw: ${clip(String(rtError))}`,
      input: md,
      kind: "b-canonical-not-byte-stable",
      signature: `b|throw|${anonymize(String(rtError))}`,
    });
    return found;
  }
  if (out.trimEnd() !== md.trimEnd()) {
    found.push({
      detail: firstDiff(md.trimEnd(), out.trimEnd()),
      input: md,
      kind: "b-canonical-not-byte-stable",
      signature: "b|trimmed-drift",
    });
  } else if (md.trim() !== "" && md === `${md.trimEnd()}\n` && out !== md) {
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
  return found;
};

const hunt = (md: string): Violation[] => {
  let analysis: Analysis;
  try {
    analysis = analyzeMarkdown(md);
  } catch (error) {
    return [
      {
        detail: clip(String(error)),
        input: md,
        kind: "a-analyze-throw",
        signature: `a|${anonymize(String(error))}`,
      },
    ];
  }

  let out: string | null = null;
  let rtError: string | null = null;
  try {
    out = roundTrip(md);
  } catch (error) {
    rtError = String(error);
  }

  const found = gateViolations(md, analysis, out, rtError);
  if (out !== null) {
    found.push(...idempotenceViolations(md, out));
  }
  if (analysis.canonical) {
    found.push(...canonicalViolations(md, out, rtError));
  }
  return found;
};

const shrink = (input: string, target: Violation, budget: number): string => {
  // pathological inputs stay as-is
  if (input.length > 4000) {
    return input;
  }
  let current = input;
  let remaining = budget;
  // same signature, not just same kind: greedy removal must not slide into a different, smaller bug
  const violates = (candidate: string): boolean => {
    if (remaining <= 0) {
      return false;
    }
    remaining -= 1;
    return hunt(candidate).some((v) => v.signature === target.signature);
  };
  let improved = true;
  while (improved) {
    improved = false;
    const lines = current.split("\n");
    if (lines.length > 1) {
      for (let i = 0; i < lines.length; i += 1) {
        const candidate = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
        if (candidate !== current && violates(candidate)) {
          current = candidate;
          improved = true;
          break;
        }
      }
      if (improved) {
        continue;
      }
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
      if (removed || chunk === 1) {
        break;
      }
    }
    if (remaining <= 0) {
      break;
    }
  }
  return current;
};

const report = (cases: Iterable<readonly [string, string]>): string[] => {
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
    const fresh = hunt(minimal).find((v) => v.signature === violation.signature);
    const detail = fresh ? fresh.detail : violation.detail;
    lines.add(
      `${violation.kind} [${violation.name}] input=${JSON.stringify(clip(minimal, 200))} :: ${detail}`,
    );
  }
  return [...lines].toSorted();
};

const CORPUS = {
  "alert-bold-fake": "> **[!NOTE]** x\n",
  "alert-caution-important": "> [!CAUTION] c\n\n> [!IMPORTANT] i\n",
  "alert-hard-break": "> [!NOTE] a\\\n> b\n",
  "alert-inside-quote": "> > [!NOTE] inner\n",
  "alert-inside-toggle": "<toggle>\n  > [!NOTE]\n  > hey\n</toggle>\n",
  "alert-list-first-child": "> - [!NOTE] fake\n",
  "alert-lowercase-fake": "> [!note] x\n",
  "alert-minimal": "> [!NOTE] x\n",
  "alert-multiline": "> [!TIP]\n> first\n> second\n",
  "alert-nested-quote": "> [!NOTE]\n>\n> > inner\n",
  "alert-no-trailing-newline": "> [!NOTE] x",
  "alert-wiki-math": "> [!TIP] see [[x#y|z]] and $$a+b$$\n",
  "alert-with-fence": "> [!NOTE]\n>\n> ```js\n> code()\n> ```\n",
  "alert-with-list": "> [!WARNING]\n>\n> - a\n> - b\n",
  "autolink-angle": "<https://example.com>\n",
  "autolink-angle-email": "<a@b.cd>\n",
  "bare-attr": "<callout draft>\n  x\n</callout>\n",
  "bare-email-literal": "contact a@b.cd today\n",
  "bare-https-literal": "see https://example.com now\n",
  "bidi-override": "a‮b‬c\n",
  "blank-run-middle": "a\n\n\n\n\nb\n",
  "bom-only": "﻿",
  "bom-then-heading": "﻿# Hi\n",
  "callout-empty": "<callout>\n</callout>\n",
  "callout-unknown-string-attr": '<callout foo="bar">\n  x\n</callout>\n',
  "callout-user-id-attr": '<callout id="keep">\n  x\n</callout>\n',
  "column-group-minimal": "<column_group>\n  <column>\n    a\n  </column>\n</column_group>\n",
  "combining-marks-nfd": "café nfd\n",
  "cr-only-line-ending": "a\rb\n",
  "crlf-mixed": "a\r\nb\nc\r\n",
  "date-with-children": '<date value="2026-01-01">label</date> x\n',
  "definition-only": "[b]: /url\n",
  "dollar-adjacent": "$5-$6 and \\$7 and $$ at EOL $$\n",
  "dollar-inline-empty": "a $$$$ b\n",
  "dollar-run-alone": "$$$$\n",
  "em-strong-mixed": "***a*** and **_b_** and _**c**_\n",
  "email-in-alert": "> [!NOTE] mail a@b.cd ok\n",
  "email-in-heading": "# mail a@b.cd\n",
  "email-in-quote": "> a@b.cd\n",
  "email-in-table": "| a@b.cd |\n| ------ |\n| x      |\n",
  "email-in-toggle": "<toggle>\n  a@b.cd\n</toggle>\n",
  "embed-in-list": "- ![[img.png|300]]\n",
  "emphasis-wrapping-wiki": "_[[a]]_ and **[[b]]** tail\n",
  empty: "",
  "empty-list-item": "-\n",
  "empty-todo": "- [ ]\n",
  entities: "&nbsp;&mdash;&amp;\n",
  "esm-import-line": 'import x from "y"\n\nprose\n',
  "expression-attr": "<toggle open={true}>\n  x\n</toggle>\n",
  "expression-flow": "{count + 1}\n",
  "expression-inline": "a {expr} b\n",
  "fence-close-indented": "```\nx\n ```\n",
  "fence-growth": "````\n```\ninner\n```\n````\n",
  "fence-unclosed": "```js\ncode\n",
  "file-bare": "<file />\n",
  footnote: "text[^1]\n\n[^1]: the note\n",
  "footnote-with-wiki": "x[^1]\n\n[^1]: see [[x]]\n",
  "form-feed-only": "\f",
  fragment: "<>\nx\n</>\n",
  "frontmatter-after-blank": "\n---\na: 1\n---\n",
  "frontmatter-crlf": "---\r\na: 1\r\n---\r\nbody\r\n",
  "frontmatter-empty": "---\n---\n",
  "frontmatter-four-dashes": "----\n",
  "frontmatter-trailing-spaces-inside": "---\nkey: v   \n---\n",
  "frontmatter-two-blocks": "---\na: 1\n---\n\n---\nb: 2\n---\n",
  "frontmatter-unicode": "---\ntitle: héllo — \u{1F389}\n---\n",
  "frontmatter-yaml-hash": "---\n# comment\nkey: v\n---\n\nbody\n",
  "hard-break-eof": "a\\\n",
  "heading-empty": "#\n",
  "heading-seven-hashes": "####### seven\n",
  "heading-trailing-hashes": "# a #\n",
  "hr-prose-hr": "***\n\nkey: value\n\n***\n",
  "hr-then-empty-item": "___\n\n-\n",
  "hr-variants": "***\n\n___\n\n- - -\n",
  "html-comment": "<!-- hidden -->\n",
  "ideographic-space-only": "　",
  "image-title": '![a](u "t")\n',
  "jsx-indented": "  <toggle>\n  x\n  </toggle>\n",
  "lazy-continuation": "> a\nb\n",
  "line-separator-only": "\u2028",
  "link-angle-destination": "[a](<b c>)\n",
  "link-empty-url": "[a]()\n",
  "link-title": '[a](u "t")\n',
  "list-item-only-fence": "- ```\n  x\n  ```\n",
  "lone-surrogate": "a\uD800b\n",
  "loose-list": "- a\n\n- b\n",
  "lowercase-div": "<Div>x</Div>\n",
  "lt-digit": "returns in <50ms\n",
  "lt-space": "a < b\n",
  "mailto-explicit": "[a@b.cd](mailto:a@b.cd)\n",
  "many-trailing-newlines": "# Hi\n\n\n",
  "math-display": "$$\nE = mc^2\n$$\n",
  "math-display-unclosed": "$$\nx\n",
  "math-inline-eol": "before $$x+y$$\n",
  "math-inline-pipe": "$$a|b$$\n",
  "math-meta-line": "$$latex\nx\n$$\n",
  "media-embed-bare": "<media_embed />\n",
  "nbsp-in-text": "a b\n",
  "nbsp-list-marker": "- item\n",
  "nbsp-only": " ",
  "no-trailing-newline": "# Hi",
  "nul-byte": "a b\n",
  "ordered-padded": "003. a\n",
  "ordered-paren-marker": "1) a\n",
  "ordered-start-zero": "0. a\n",
  "quote-with-fence": "> ```\n> x\n> ```\n",
  "reference-image": "![a][b]\n\n[b]: /u\n",
  "reference-link": "[a][b]\n\n[b]: /url\n",
  "rtl-mixed": "עברית and العربية mixed\n",
  "setext-heading": "Title\n=====\n\nbody\n",
  "single-tilde-strike": "~x~ mid ~~y~~\n",
  "spaces-only": "   ",
  "spread-attr": "<toggle {...props}>\n  x\n</toggle>\n",
  "tab-indented-code": "\tindented code\n",
  "tab-inline": "a\tb\n",
  "table-alignment": "| a | b | c |\n|:- | -:|:-:|\n| 1 | 2 | 3 |\n",
  "table-code-span-pipe": "| `a|b` |\n| ----- |\n| x     |\n",
  "table-empty-cells": "| a |  |\n| - | - |\n|   | b |\n",
  "table-escaped-pipe": "| a\\|b |\n| ---- |\n| c    |\n",
  "table-inline-jsx":
    '| <date value="2026-01-01" /> |\n| --------------------------- |\n| y                           |\n',
  "table-inside-toggle": "<toggle>\n  | a |\n  | - |\n  | b |\n</toggle>\n",
  "table-ragged-body-long": "| a |\n| - |\n| 1 | 2 |\n",
  "table-ragged-body-short": "| a | b |\n| - | - |\n| 1 |\n",
  "table-ragged-header": "| a |\n| - | - |\n",
  "tilde-fence": "~~~js\ncode\n~~~\n",
  "todo-capital-x": "- [X] done\n",
  "toggle-attr-braces-string": '<toggle t="{notexpr}">\n  x\n</toggle>\n',
  "toggle-attr-newline": '<toggle t="a\nb">\n  x\n</toggle>\n',
  "toggle-attr-quote-entities": '<toggle t="say &#x22;hi&#x22;">\n  x\n</toggle>\n',
  "toggle-attr-unicode": '<toggle t="héllo \u{1F389} عرب">\n  x\n</toggle>\n',
  "toggle-empty-attr": '<toggle t="">\n  x\n</toggle>\n',
  "toggle-inline-position": "before <toggle>x</toggle> after\n",
  "toggle-self-closing": "<toggle />\n",
  "trailing-space-runs": "a \nb  \nc   \n",
  "two-leading-hrs": "***\n\n***\n",
  "unclosed-tag": "<toggle>\nnever closed\n",
  "underscore-in-word": "snake_case_name stays\n",
  "unknown-component": "<Steps>\n  x\n</Steps>\n",
  "url-equals-text": "[https://example.com](https://example.com)\n",
  "url-parens": "see https://x.cd/a(1) ok\n",
  "vertical-tab-only": "\v",
  "video-bare": "<video />\n",
  "video-empty-src": '<video src="" />\n',
  "video-id-attr": '<video id="a" src="u" />\n',
  "web-component-tag": "a <x-y>z</x-y> b\n",
  "wiki-adjacent": "[[a]][[b]]\n",
  "wiki-backslash-body": "[[a\\b]]\n",
  "wiki-double-bang": "!![[a]]\n",
  "wiki-escaped-open": "\\[[x]]\n",
  "wiki-in-code-span": "`[[a|b]]` stays code\n",
  "wiki-in-fence": "```\n[[a|b]] ]] |\n```\n",
  "wiki-in-table-escaped-pipe": "| [[a\\|b]] |\n| -------- |\n| x        |\n",
  "wiki-only-pipe": "[[|]]\n",
  "wiki-pipe-alias": "[[a|b]] and [[a#b|c]]\n",
  "wiki-single-close": "[[a]b]]\n",
  "wiki-space-body": "[[ ]]\n",
  "wiki-then-parens": "[[a]](b)\n",
  "wiki-trailing-space": "[[a ]]\n",
  "wiki-unclosed": "[[a\n",
  "wiki-unicode-body": "[[\u{1F389} עברית]]\n",
  "wiki-url-body": "[[https://x.cd]]\n",
  "www-literal": "see www.example.com now\n",
  "zero-width-space": "a​b\n",
  "zwj-emoji-family": "family \u{1F469}‍\u{1F469}‍\u{1F467}‍\u{1F466} here\n",
} satisfies Record<string, string>;

// oxlint-disable no-bitwise -- mulberry32 is defined in terms of 32-bit word math; the seeded sequence is the point
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};
// oxlint-enable no-bitwise

const FRAGMENTS: string[] = Object.values(CORPUS).filter(
  (f) => f.trim() !== "" && !f.startsWith("---") && !f.startsWith("﻿") && !f.startsWith("\n"),
);
const FRONTMATTERS = ["---\na: 1\n---", "---\n---", "---\ntitle: héllo — ok\nlist:\n  - 1\n---"];
const PUNCT = "[](){}<>|!#$*_~`\\-+.:@\"' \n";

const fuzzDocs = (count: number): [string, string][] => {
  const rand = mulberry32(0xc0_ff_ee);
  const int = (n: number) => Math.floor(rand() * n);
  const pick = <T>(xs: readonly T[]): T | undefined => xs[int(xs.length)];
  const docs: [string, string][] = [];
  for (let i = 0; i < count; i += 1) {
    let doc: string;
    if (i % 5 === 4) {
      const len = 1 + int(40);
      let s = "";
      for (let j = 0; j < len; j += 1) {
        s += PUNCT[int(PUNCT.length)] ?? "";
      }
      doc = s;
    } else {
      const parts: string[] = [];
      if (rand() < 0.25) {
        parts.push(pick(FRONTMATTERS) ?? "");
      }
      const n = 2 + int(7);
      for (let j = 0; j < n; j += 1) {
        parts.push((pick(FRAGMENTS) ?? "").trimEnd());
      }
      doc = `${parts.join("\n\n")}\n`;
      if (rand() < 0.2 && !doc.includes("\r")) {
        doc = doc.replaceAll("\n", "\r\n");
      }
      if (rand() < 0.2) {
        const lines = doc.split("\n");
        const k = int(lines.length);
        lines[k] = `${lines[k] ?? ""}  `;
        doc = lines.join("\n");
      }
      if (rand() < 0.15) {
        doc = doc.replace(" ", "\t");
      }
      if (rand() < 0.15) {
        const at = int(doc.length);
        doc = `${doc.slice(0, at)}​${doc.slice(at)}`;
      }
      if (rand() < 0.1) {
        doc = doc.trimEnd();
      }
      if (rand() < 0.05) {
        doc = `﻿${doc}`;
      }
    }
    docs.push([`fuzz-${i}`, doc]);
  }
  return docs;
};

describe("adversarial round-trip hunt", () => {
  it("handcrafted corpus upholds the gate invariants", { timeout: 90_000 }, () => {
    expect(report(Object.entries(CORPUS))).toEqual([]);
  });

  it("seeded fuzz corpus upholds the gate invariants", { timeout: 120_000 }, () => {
    expect(report(fuzzDocs(140))).toEqual([]);
  });

  it("pathological nesting never escapes analyzeMarkdown", { timeout: 120_000 }, () => {
    // depth 3000 is past the mdast→Slate recursion limit (~1250 on Node defaults)
    // but inside micromark's own (~6-8k), so it exercises the conversion overflow
    const deep: [string, string][] = [
      ["blockquote-depth-3000", `${"> ".repeat(3000)}x\n`],
      ["toggle-depth-300", `${"<toggle>\n".repeat(300)}x\n${"</toggle>\n".repeat(300)}`],
      [
        "list-depth-300",
        `${Array.from({ length: 300 }, (_, i) => `${"  ".repeat(i)}- x`).join("\n")}\n`,
      ],
      ["emphasis-run-2000", `${"*".repeat(2000)}x\n`],
      ["bracket-run-2000", `${"[".repeat(2000)}x\n`],
      ["long-line-200kb", `${"word ".repeat(40_000)}\n`],
    ];
    expect(report(deep)).toEqual([]);
  });
});
