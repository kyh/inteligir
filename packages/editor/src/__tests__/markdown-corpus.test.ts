import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { analyzeMarkdown, roundTrip } from "@repo/editor/markdown/markdown-doc";
import { SAMPLE_NOTES } from "./sample-notes";

type Classification =
  | "canonical" // byte-stable
  | "formattable" // rich-safe, one Format away from canonical
  | "letters-diverge" // parses, but round-trip drops content → Raw
  | `raw:${string}`; // rawReason.kind

function classify(md: string): Classification {
  const analysis = analyzeMarkdown(md);
  if (analysis.rawReason) return `raw:${analysis.rawReason.kind}`;
  if (analysis.canonical) return "canonical";
  return analysis.richSafe ? "formattable" : "letters-diverge";
}

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

const REPO_DOCS = {
  "README.md": readFileSync(`${REPO_ROOT}/README.md`, "utf8"),
} satisfies Record<string, string>;

const EXPECTED = {
  "README.md": "formattable", // wrapped paragraphs → soft-break churn
  // the fixture vault is pre-canonicalized so a first edit is a minimal diff, not a reflow.
  "empty.md": "canonical",
  "welcome.md": "canonical",
  "tasks.md": "canonical",
  "notes/roadmap.md": "canonical",
  "notes/snippets.md": "canonical",
  "notes/archive/2025-recap.md": "canonical",
  "journal.md": "canonical",
  "kitchen-sink.md": "canonical",
  "legacy-web-clip.md": "raw:parse-error",
  "frontmatter-note.md": "canonical",
  "private-note.md": "canonical",
  "tagged.md": "canonical",
  // legacy <callout> jsx converts to the fence and the attribute-name letters go with it.
  "components-playground.md": "letters-diverge",
  "math-and-diagrams.md": "canonical",
  "wiki/hub.md": "canonical",
  "wiki/target note.md": "canonical",
  "wiki/ideas.md": "canonical",
  "wiki/projects.md": "canonical",
  "wiki/digest.md": "canonical",
} satisfies Record<string, Classification>;

const CORPUS = new Map([...Object.entries(REPO_DOCS), ...Object.entries(SAMPLE_NOTES)]);

const letters = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

describe("legacy corpus classification", () => {
  it("covers every corpus file with an expectation", () => {
    expect([...CORPUS.keys()].toSorted()).toEqual(Object.keys(EXPECTED).toSorted());
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name} → ${expected}`, () => {
      const md = CORPUS.get(name);
      expect(md).toBeDefined();
      if (md === undefined) return;
      expect(classify(md)).toBe(expected);
    });
  }

  it("round-trips rich-safe corpus files idempotently and letters-preserving", () => {
    for (const [name, md] of CORPUS) {
      const analysis = analyzeMarkdown(md);
      if (!analysis.richSafe || md.trim() === "") continue;
      const once = roundTrip(md);
      expect(roundTrip(once), `${name} must be idempotent`).toBe(once);
      expect(letters(once), `${name} must preserve content`).toBe(letters(md));
    }
  });
});
