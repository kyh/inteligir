import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ParseFailedError,
  analyzeMarkdown,
  roundTrip,
  toCanonical,
} from "@repo/editor/markdown/markdown-doc";

// The fixture matrix — the serialization pipeline's contract, one file per
// behavior class:
//
//   canonical/*.md          roundTrip(src) === src (modulo trailing newline),
//                           idempotent, analyzeMarkdown(src).canonical === true.
//   raw/*.<kind>.md         analyzeMarkdown(src).richSafe === false with the
//                           expected RawReason.kind encoded in the filename —
//                           never mangled, never Rich; roundTrip throws.
//   churn/*.{in,out}.md     roundTrip(in) === out, roundTrip(out) === out
//                           (idempotent normalization); rich-safe where marked.
//
// The raw set holds ONLY documents that do not parse. Constructs the editor
// has no node for — raw HTML, `{…}` expressions, unknown JSX — are opaque nodes
// and belong in the canonical set instead.
//
// A serializer change that reshapes ANY byte of a canonical fixture is a
// regression — fix the serializer, don't re-pin the fixture, unless the change
// is a conscious canonical-form revision documented in the commit.

const FIXTURES = fileURLToPath(new URL("fixtures/roundtrip/", import.meta.url));

function read(dir: "canonical" | "raw" | "churn", name: string): string {
  return readFileSync(`${FIXTURES}${dir}/${name}`, "utf8");
}
function list(dir: "canonical" | "raw" | "churn"): string[] {
  return readdirSync(`${FIXTURES}${dir}`).toSorted();
}

describe("canonical fixtures (byte-stable)", () => {
  for (const name of list("canonical")) {
    it(name, () => {
      const src = read("canonical", name);
      const out = roundTrip(src);
      expect(out.trimEnd()).toBe(src.trimEnd());
      expect(roundTrip(out)).toBe(out); // idempotent
      const analysis = analyzeMarkdown(src);
      expect(analysis.canonical).toBe(true);
      expect(analysis.richSafe).toBe(true);
      expect(analysis.rawReason).toBeNull();
    });
  }
});

describe("raw fixtures (throw-or-Raw, never mangled)", () => {
  for (const name of list("raw")) {
    // Expected reason kind is the filename's second-to-last segment,
    // e.g. `attr-bare.jsx-attr.md` → "jsx-attr".
    const kind = name.split(".").at(-2);
    it(`${name} → ${kind}`, () => {
      const src = read("raw", name);
      const analysis = analyzeMarkdown(src);
      expect(analysis.richSafe).toBe(false);
      expect(analysis.canonical).toBe(false);
      expect(analysis.rawReason?.kind).toBe(kind);
      expect(() => roundTrip(src)).toThrow(ParseFailedError);
    });
  }
});

// Churn fixtures that are NOT rich-safe: their round-trip drops alphanumeric
// content (letters() diverges), so they open Raw and only Format converts them.
//   math-meta       — the `$$latex` meta line is dropped by Plate's equation rule
//   entities        — `&nbsp;`/`&mdash;` decode ("nbsp"/"mdash" letters vanish)
//   jsx-attr-forms  — `&amp;` inside an attribute decodes likewise
//   mailto-resource — `[a@b.cd](mailto:a@b.cd)` collapses to the bare literal
//                     (same link on re-parse, but the "mailto" letters vanish)
const CHURN_NOT_RICH_SAFE = new Set(["math-meta", "entities", "jsx-attr-forms", "mailto-resource"]);

describe("churn fixtures (idempotent normalization)", () => {
  const stems = list("churn")
    .filter((n) => n.endsWith(".in.md"))
    .map((n) => n.slice(0, -".in.md".length));
  for (const stem of stems) {
    it(stem, () => {
      const input = read("churn", `${stem}.in.md`);
      const expected = read("churn", `${stem}.out.md`);
      const out = roundTrip(input);
      expect(out.trimEnd()).toBe(expected.trimEnd());
      expect(roundTrip(out)).toBe(out); // idempotent
      const analysis = analyzeMarkdown(input);
      expect(analysis.canonical).toBe(false);
      expect(analysis.richSafe).toBe(!CHURN_NOT_RICH_SAFE.has(stem));
      // The normalized form is canonical from then on.
      expect(analyzeMarkdown(toCanonical(input)).canonical).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Gate API behaviors carried over from the predecessor suite (markdown-doc.ts's
// isCanonical/isRichSafe/toCanonical) — same assertions, new API.
// ---------------------------------------------------------------------------

describe("analyzeMarkdown", () => {
  it("treats empty / whitespace-only docs as canonical and rich-safe", () => {
    for (const doc of ["", "\n\n", "   "]) {
      const analysis = analyzeMarkdown(doc);
      expect(analysis.canonical).toBe(true);
      expect(analysis.richSafe).toBe(true);
      expect(analysis.rawReason).toBeNull();
    }
  });

  it("accepts formatting-only differences as rich-safe but not canonical", () => {
    // `*` bullets reflow to `-` and `***` to `---`: not byte-identical, but no
    // content is dropped, so Rich editing is lossless.
    const md = "* one\n* two\n\n***\n\nbody\n";
    const analysis = analyzeMarkdown(md);
    expect(analysis.canonical).toBe(false);
    expect(analysis.richSafe).toBe(true);
  });

  it("does not invent content for an empty document", () => {
    expect(roundTrip("").trim()).toBe("");
  });
});

describe("toCanonical", () => {
  it("is idempotent and ends with a single trailing newline", () => {
    const once = toCanonical("# Hi\n\n- a\n- b");
    expect(once.endsWith("\n")).toBe(true);
    expect(once.endsWith("\n\n")).toBe(false);
    expect(toCanonical(once)).toBe(once);
    expect(analyzeMarkdown(once).canonical).toBe(true);
  });

  it("canonicalizes messy-but-parseable markdown stably", () => {
    const messy = "Title\n=====\n\n\n\nbody";
    const canon = toCanonical(messy);
    expect(analyzeMarkdown(canon).canonical).toBe(true);
    expect(toCanonical(canon)).toBe(canon);
  });

  it("throws ParseFailedError when there is nothing safe to format to", () => {
    expect(() => toCanonical("<Foo>x</Bar>\n")).toThrow(ParseFailedError);
    expect(() => toCanonical("{unclosed brace\n")).toThrow(ParseFailedError);
  });

  it("formats a document whose constructs it cannot model", () => {
    // Constructs with no editor node are held verbatim, not rejected.
    for (const md of ["returns in <50ms\n", "<Steps>x</Steps>\n", "<!-- c -->\n"]) {
      expect(analyzeMarkdown(toCanonical(md)).canonical, md).toBe(true);
    }
  });
});
