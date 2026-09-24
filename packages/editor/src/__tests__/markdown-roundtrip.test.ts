import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  RoundTripError,
  analyzeMarkdown,
  roundTrip,
  toCanonical,
} from "@repo/editor/markdown/markdown-doc";

// raw/ holds only documents that do not parse; constructs with no editor node are
// opaque and belong in canonical/. A serializer change that reshapes a canonical
// fixture is a regression: fix the serializer, never re-pin.

const FIXTURES = fileURLToPath(new URL("fixtures/roundtrip/", import.meta.url));

const read = (dir: "canonical" | "raw" | "churn", name: string): string =>
  readFileSync(`${FIXTURES}${dir}/${name}`, "utf-8");
const list = (dir: "canonical" | "raw" | "churn"): string[] =>
  readdirSync(`${FIXTURES}${dir}`).toSorted();

describe("canonical fixtures (byte-stable)", () => {
  for (const name of list("canonical")) {
    it(name, () => {
      const src = read("canonical", name);
      const out = roundTrip(src);
      expect(out.trimEnd()).toBe(src.trimEnd());
      expect(roundTrip(out)).toBe(out);
      expect(analyzeMarkdown(src)).toEqual({ kind: "canonical" });
    });
  }
});

describe("raw fixtures (throw-or-Raw, never mangled)", () => {
  for (const name of list("raw")) {
    // the expected kind is the filename's second-to-last segment
    const kind = name.split(".").at(-2);
    it(`${name} → ${kind}`, () => {
      const src = read("raw", name);
      expect(analyzeMarkdown(src).kind).toBe(kind);
      expect(() => roundTrip(src)).toThrow(RoundTripError);
    });
  }
});

// their round-trip drops letters (a `$$latex` meta line, entity decoding, the
// "mailto" and "variant" spellings), so they open Raw as roundtrip-loss
const CHURN_NOT_RICH_SAFE = new Set([
  "math-meta",
  "entities",
  "jsx-attr-forms",
  "jsx-callout",
  "mailto-resource",
]);

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
      expect(roundTrip(out)).toBe(out);
      expect(analyzeMarkdown(input).kind).toBe(
        CHURN_NOT_RICH_SAFE.has(stem) ? "roundtrip-loss" : "normalizes",
      );
      expect(analyzeMarkdown(toCanonical(input)).kind).toBe("canonical");
    });
  }
});

describe("analyzeMarkdown", () => {
  it("treats empty / whitespace-only docs as canonical and rich-safe", () => {
    for (const doc of ["", "\n\n", "   "]) {
      expect(analyzeMarkdown(doc)).toEqual({ kind: "canonical" });
    }
  });

  it("accepts formatting-only differences as rich-safe but not canonical", () => {
    const md = "* one\n* two\n\n***\n\nbody\n";
    expect(analyzeMarkdown(md)).toEqual({ kind: "normalizes" });
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
    expect(analyzeMarkdown(once).kind).toBe("canonical");
  });

  it("canonicalizes messy-but-parseable markdown stably", () => {
    const messy = "Title\n=====\n\n\n\nbody";
    const canon = toCanonical(messy);
    expect(analyzeMarkdown(canon).kind).toBe("canonical");
    expect(toCanonical(canon)).toBe(canon);
  });

  it("throws RoundTripError when there is nothing safe to format to", () => {
    expect(() => toCanonical("<Foo>x</Bar>\n")).toThrow(RoundTripError);
    expect(() => toCanonical("{unclosed brace\n")).toThrow(RoundTripError);
  });

  it("formats a document whose constructs it cannot model", () => {
    for (const md of ["returns in <50ms\n", "<Steps>x</Steps>\n", "<!-- c -->\n"]) {
      expect(analyzeMarkdown(toCanonical(md)).kind, md).toBe("canonical");
    }
  });
});
