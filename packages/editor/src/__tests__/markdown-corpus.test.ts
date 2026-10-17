import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { analyzeMarkdown, gateReasonFor, roundTrip } from "@repo/editor/markdown/markdown-doc";
import { SAMPLE_NOTES } from "./sample-notes";

type Classification =
  // byte-stable
  | "canonical"
  // rich-safe, one Format away from canonical
  | "formattable"
  // parses, but round-trip drops content → Raw
  | "letters-diverge"
  // the gate's reason for every other refusal
  | `raw:${string}`;

const classify = (md: string): Classification => {
  const analysis = analyzeMarkdown(md);
  switch (analysis.kind) {
    case "canonical": {
      return "canonical";
    }
    case "normalizes": {
      return "formattable";
    }
    case "roundtrip-loss": {
      return "letters-diverge";
    }
    default: {
      return `raw:${analysis.kind}`;
    }
  }
};

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

const REPO_DOCS = {
  "README.md": readFileSync(`${REPO_ROOT}/README.md`, "utf-8"),
} satisfies Record<string, string>;

// Object.entries below declares the tests in this order, which groups the repo doc ahead of the
// vault fixtures
const EXPECTED = {
  // wrapped paragraphs → soft-break churn
  "README.md": "formattable",
  // the fixture vault is pre-canonicalized so a first edit is a minimal diff, not a reflow.
  "empty.md": "canonical",
  "welcome.md": "canonical",
  "tasks.md": "canonical",
  "notes/roadmap.md": "canonical",
  "notes/snippets.md": "canonical",
  "notes/archive/2025-recap.md": "canonical",
  "journal.md": "canonical",
  "kitchen-sink.md": "canonical",
  // the angle autolink saves bare; the stray `{`, `<50ms` and the html stay
  "legacy-web-clip.md": "formattable",
  "frontmatter-note.md": "canonical",
  "private-note.md": "canonical",
  "tagged.md": "canonical",
  "components-playground.md": "canonical",
  "math-and-diagrams.md": "canonical",
  "wiki/hub.md": "canonical",
  "wiki/target note.md": "canonical",
  "wiki/ideas.md": "canonical",
  "wiki/projects.md": "canonical",
  "wiki/digest.md": "canonical",
} satisfies Record<string, Classification>;

const CORPUS = new Map([...Object.entries(REPO_DOCS), ...Object.entries(SAMPLE_NOTES)]);

const letters = (s: string) => s.replaceAll(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

describe("legacy corpus classification", () => {
  it("covers every corpus file with an expectation", () => {
    expect([...CORPUS.keys()].toSorted()).toEqual(Object.keys(EXPECTED).toSorted());
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name} → ${expected}`, () => {
      const md = CORPUS.get(name);
      expect(md).toBeDefined();
      if (md === undefined) {
        return;
      }
      expect(classify(md)).toBe(expected);
    });
  }

  it("round-trips rich-safe corpus files idempotently and letters-preserving", () => {
    for (const [name, md] of CORPUS) {
      if (gateReasonFor(analyzeMarkdown(md)) !== null || md.trim() === "") {
        continue;
      }
      const once = roundTrip(md);
      expect(roundTrip(once), `${name} must be idempotent`).toBe(once);
      expect(letters(once), `${name} must preserve content`).toBe(letters(md));
    }
  });
});

// the items a first run copies into a new library, which a new person opens before saving their own
const SEED_DIR = `${REPO_ROOT}/apps/cli/seed/`;

describe("the starter library", () => {
  const notes = readdirSync(SEED_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.relative(SEED_DIR, path.join(entry.parentPath, entry.name)));

  it("is found at all", () => {
    expect(notes.length).toBeGreaterThan(0);
  });

  for (const name of notes.toSorted()) {
    it(`${name} opens rich and saves byte-exact`, () => {
      expect(classify(readFileSync(`${SEED_DIR}${name}`, "utf-8"))).toBe("canonical");
    });
  }
});
