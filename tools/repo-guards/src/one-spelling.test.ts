// a second answer to a question that already has one is how the expensive bugs arrive: a marker one
// reader strips and another leaves in the text. detection is textual and a lower bound: it finds
// the shapes these were actually re-spelled in.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, sourceOf, workspaceFiles, workspaces } from "./repo";

interface Hit {
  file: string;
  what: string;
}

interface Predicate {
  question: string;
  home: string;
  use: string;
  detect: (source: string) => string[];
  elsewhere: Record<string, string>;
}

const PREDICATES: Predicate[] = [
  {
    detect: (source) =>
      source.includes("%%i:[^%]*%%") ? ["spells the loose annotation-marker regex"] : [],
    elsewhere: {},
    home: "packages/notes/src/markdown/remark-inline-constructs.ts",
    question: "where do annotation markers, half-typed ones included, sit in raw bytes?",
    use: "ANNOTATION_MARKER_STRIP_RE",
  },
];

// this file spells every shape it searches for and would otherwise always find itself.
const SELF = path.relative(REPO_ROOT, import.meta.filename);

// tests included: a second spelling in a guard is still a second spelling.
const allSourceFiles = (): string[] =>
  workspaces()
    .flatMap((workspace) => {
      const files = workspaceFiles(workspace);
      return [...files.shipped, ...files.test];
    })
    .filter((file) => file !== SELF)
    .toSorted();

const hitsFor = (predicate: Predicate, files: readonly string[]): Hit[] =>
  files.flatMap((file) => predicate.detect(sourceOf(file)).map((what) => ({ file, what })));

describe("one spelling per cross-cutting predicate", () => {
  const files = allSourceFiles();

  it("every declared home exists and still answers its question", () => {
    const violations: string[] = [];
    for (const predicate of PREDICATES) {
      if (!fs.existsSync(path.join(REPO_ROOT, predicate.home))) {
        violations.push(
          `MISSING HOME  ${predicate.home}\n` +
            `  rule: "${predicate.question}" is answered in one declared file; that file is gone\n` +
            `  fix: point this row at wherever the answer moved to`,
        );
        continue;
      }
      if (predicate.detect(sourceOf(predicate.home)).length === 0) {
        violations.push(
          `BLIND DETECTOR  ${predicate.home}\n` +
            `  rule: the detector for "${predicate.question}" no longer matches its own home, so it would find no re-implementation either\n` +
            `  fix: the shape changed — teach the detector the new one before trusting a green run`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("nothing outside the home answers the same question", () => {
    const violations: string[] = [];
    for (const predicate of PREDICATES) {
      for (const hit of hitsFor(predicate, files)) {
        if (hit.file === predicate.home) {
          continue;
        }
        if (predicate.elsewhere[hit.file] !== undefined) {
          continue;
        }
        violations.push(
          `SECOND SPELLING  ${hit.file}\n` +
            `  found: ${hit.what}\n` +
            `  rule: "${predicate.question}" has ONE answer in this repo, and two answers to it differ in their edge cases long before anyone notices\n` +
            `  home:  ${predicate.home} — use ${predicate.use}\n` +
            `  fix: call the home, or add a row to this predicate's \`elsewhere\` saying why this site answers a different question`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("no `elsewhere` row is stale", () => {
    const stale: string[] = [];
    for (const predicate of PREDICATES) {
      const matched = new Set(hitsFor(predicate, files).map((hit) => hit.file));
      for (const [file, why] of Object.entries(predicate.elsewhere)) {
        if (matched.has(file)) {
          continue;
        }
        stale.push(
          `STALE EXCEPTION  ${file}\n` +
            `  it no longer spells "${predicate.question}", so the reason it carried is spent\n` +
            `  the reason was: ${why}\n` +
            `  fix: delete the row from ${predicate.home}'s predicate in tools/repo-guards/src/one-spelling.test.ts`,
        );
      }
    }
    expect(stale, `\n${stale.join("\n\n")}\n`).toEqual([]);
  });
});
