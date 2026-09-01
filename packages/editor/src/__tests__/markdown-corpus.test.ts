import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { analyzeMarkdown, roundTrip } from "@repo/editor/markdown/markdown-doc";
import { SAMPLE_NOTES } from "./sample-notes";

// Legacy-corpus tripwire: real-world markdown from this repo + every dev
// fixture-vault note gets an EXPLICIT expected classification. If a pipeline
// change silently moves a file between classes (e.g. a new remark plugin turns
// ordinary prose Raw), this test turns that drift into a red diff instead of a
// surprise — "the canonical set must not silently shrink for ordinary prose."

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

// The expected-set. A change here must be a conscious decision, not a driveby.
const EXPECTED = {
  // repo docs (real-world hand-written markdown)
  "README.md": "formattable", // wrapped paragraphs → soft-break churn
  // dev fixture vault — pre-canonicalized: a first edit must produce a
  // minimal diff, not a wholesale reflow. legacy-web-clip.md stays the Raw
  // exemplar; README.md above keeps the formattable path covered.
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
  // Vocabulary notes — canonical by construction (drafted, then pinned to
  // the pipeline's own round-trip output).
  // Carries legacy <callout> JSX: converts to the inteligir-callout fence and the
  // attribute NAME letters vanish with the mechanism (see jsx-callout churn).
  "components-playground.md": "letters-diverge",
  "math-and-diagrams.md": "canonical",
  "wiki/hub.md": "canonical",
  "wiki/target note.md": "canonical",
  // Knowledge notes — the interlinked wiki cluster + transclusion
  // sampler; canonical so knowledge surfaces demo on Rich-mode files.
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
