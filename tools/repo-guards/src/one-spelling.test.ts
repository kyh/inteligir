// ---------------------------------------------------------------------------
// One spelling per cross-cutting predicate.
//
// Every other guard in this repo checks REACHABILITY — does a declared thing
// have a producer, a consumer, a row. None of them fails when a SECOND answer
// to a question that already has one appears, and that is how this repo's most
// expensive bugs arrive: "is path P under root R" was answered five ways with
// four different edge-case sets (two of them byte-identical, refusal message
// included), and one file decoded `git status --porcelain` three ways that
// disagreed about framing, quoting and renames. A traversal that one gate
// admits and another refuses reaches the second gate believing it passed the
// first; a path spelling one reader unquotes and another does not is a file
// silently left out of a commit.
//
// So each predicate below names the question, the ONE file that answers it,
// and what a re-implementation LOOKS like. Everything the detector finds
// outside that home is either a violation naming both sites, or a row in
// `elsewhere` with the reason it is allowed to spell it too — and a row that
// stops matching fails, so an exception cannot outlive its reason.
//
// Detection is textual and therefore a lower bound, stated rather than
// implied: it finds the shapes these predicates were actually re-spelled in,
// not every shape they could be. A guard that tried to find all of them would
// have to fail OPEN on the ones it could not parse, and a fitness test may
// not do that. What it buys is that the KNOWN shape cannot come back.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, sourceOf, workspaceFiles, workspaces } from "./repo";

interface Hit {
  file: string;
  /** What was found, quoted back so the failure shows the offending shape. */
  what: string;
}

interface Predicate {
  /** The question, as a sentence — the failure states it. */
  question: string;
  /** The repo-relative file that answers it, and the symbols to reach for. */
  home: string;
  use: string;
  /** Every re-spelling in a file, or [] when the file does not answer it. */
  detect: (source: string) => string[];
  /**
   * Files allowed to spell it anyway, and why. Each is drained below: a row
   * whose file no longer matches the detector fails, so an exception cannot
   * outlive the thing it excused.
   */
  elsewhere: Record<string, string>;
}

/** `x.startsWith(<something built with a separator>)` — the prefix compare
 *  that IS containment, and the one whose separator is so easy to forget that
 *  `/vault-backup` reads as inside `/vault`. */
const JOINED_PREFIX = /\.startsWith\(\s*([^;\n]*)/g;
/** `const rel = relative(a, b)` … `rel.startsWith("..")` — the other spelling,
 *  and the one whose refusal set is never the same twice. */
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
    home: "apps/app/src/node/path-containment.ts",
    use: "pathContains() / relativeUnder()",
    detect: containmentRespellings,
    elsewhere: {
      "packages/notes/src/knowledge/rename-links.ts":
        "a LOGICAL `/`-path between two vault folders, from @repo/notes' own pure relativePath, deciding how a link is SPELLED rather than whether a write is allowed — and @repo/notes is the platform-neutral seam, so a node-only module is not importable from it at all",
      "packages/ui/src/__tests__/no-orphan-components.test.ts":
        "compares two paths this walk built itself, in a browser-only leaf; packages may not import apps (dep-dag), so the home is out of reach and there is no vault behind it to escape",
    },
  },
  {
    question: "what does `git status --porcelain` say?",
    home: "apps/app/src/node/vault/git.ts",
    use: "parsePorcelain()",
    detect: (source) => (source.includes("--porcelain") ? ["runs `git status --porcelain`"] : []),
    elsewhere: {
      "tools/e2e/src/scenarios/vault-sync.ts":
        "asserts the whole output is EMPTY, which decodes nothing — the scenario is checking that the sync loop left a clean tree, and a parser would only put a second reading between it and the bytes",
      "apps/app/src/node/vault/__tests__/git.test.ts":
        "the same emptiness assertion, made against a real repo the suite built; it decodes no entry either",
    },
  },
];

/** This file, which spells every shape it searches for and would otherwise
 *  always find itself. Derived, so moving this guard cannot silently stop the
 *  exclusion — the same reason vendor-provenance.test.ts does it this way. */
const SELF = path.relative(REPO_ROOT, import.meta.filename);

/** Every source file in the repo, shipped and test alike. A containment bug in
 *  a guard is still a containment bug. */
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
    // A home that moved, or a detector that stopped matching it, would let
    // every assertion below pass by finding nothing anywhere.
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
