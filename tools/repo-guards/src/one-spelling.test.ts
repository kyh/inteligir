// a second answer to a question that already has one is how the expensive bugs arrive: a traversal
// one gate admits and another refuses, a porcelain path one reader unquotes and another does not.
// detection is textual and a lower bound: it finds the shapes these were actually re-spelled in.

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

// the prefix compare whose separator is so easy to forget that `/vault-backup` reads as inside
// `/vault`.
const JOINED_PREFIX = /\.startsWith\(\s*([^;\n]*)/g;
const RELATIVE_BINDING = /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?[\w.]*[Rr]elative\w*\s*\(/g;

function containmentRespellings(source: string): string[] {
  const found: string[] = [];
  JOINED_PREFIX.lastIndex = 0;
  let match = JOINED_PREFIX.exec(source);
  while (match !== null) {
    const argument = (match[1] ?? "").trim();
    if (/\bsep\b/.test(argument) || /\b(?:path\.)?(?:join|resolve)\s*\(/.test(argument)) {
      found.push(`prefix compare against a joined path — .startsWith(${argument.slice(0, 70)}`);
    }
    match = JOINED_PREFIX.exec(source);
  }
  RELATIVE_BINDING.lastIndex = 0;
  match = RELATIVE_BINDING.exec(source);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined) {
      const escapes = new RegExp(
        `\\b${name}\\s*(?:\\.startsWith\\(\\s*["'\`]\\.\\.|===\\s*["'\`]\\.\\.["'\`])`,
      );
      if (escapes.test(source)) {
        found.push(
          `\`${name}\` comes from relative() and is tested against ".." — its own escape rule`,
        );
      }
    }
    match = RELATIVE_BINDING.exec(source);
  }
  return [...new Set(found)];
}

const PREDICATES: Predicate[] = [
  {
    question: "is path P under root R?",
    home: "apps/cli/src/server/path-containment.ts",
    use: "pathContains() / relativeUnder()",
    detect: containmentRespellings,
    elsewhere: {
      "packages/notes/src/knowledge/rename-links.ts":
        "a LOGICAL `/`-path between two vault folders, from @repo/notes' own pure relativePath, deciding how a link is SPELLED rather than whether a write is allowed — and @repo/notes is the platform-neutral seam, so a node-only module is not importable from it at all",
    },
  },
  {
    question: "what does `git status --porcelain` say?",
    home: "apps/cli/src/server/vault/git-porcelain.ts",
    use: "parsePorcelain()",
    detect: (source) => (source.includes("--porcelain") ? ["runs `git status --porcelain`"] : []),
    elsewhere: {
      "tools/e2e/src/scenarios/vault-sync.ts":
        "asserts the whole output is EMPTY, which decodes nothing — the scenario is checking that the sync loop left a clean tree, and a parser would only put a second reading between it and the bytes",
      "apps/cli/src/server/vault/__tests__/git.test.ts":
        "the same emptiness assertion, made against a real repo the suite built; it decodes no entry either",
    },
  },
];

// this file spells every shape it searches for and would otherwise always find itself.
const SELF = path.relative(REPO_ROOT, import.meta.filename);

// tests included: a containment bug in a guard is still a containment bug.
function allSourceFiles(): string[] {
  return workspaces()
    .flatMap((workspace) => {
      const files = workspaceFiles(workspace);
      return files.shipped.concat(files.test);
    })
    .filter((file) => file !== SELF)
    .toSorted();
}

function hitsFor(predicate: Predicate, files: readonly string[]): Hit[] {
  return files.flatMap((file) => predicate.detect(sourceOf(file)).map((what) => ({ file, what })));
}

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
        if (hit.file === predicate.home) continue;
        if (predicate.elsewhere[hit.file] !== undefined) continue;
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
        if (matched.has(file)) continue;
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
