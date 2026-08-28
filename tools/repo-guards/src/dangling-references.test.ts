// ---------------------------------------------------------------------------
// Dangling references: a name this repo writes down must be a thing this repo
// has.
//
// Every other guard here derives what it compares, and reads source with the
// comments STRIPPED. Prose and configuration therefore rot in the one direction
// nothing watches: a rename lands, the code is updated, and the sentence that
// JUSTIFIED the code is not. Three were live at once — an orphan guard whose
// exclusion named a directory deleted in a workspace rename, so it excluded
// nothing and passed without asking its question; a lint override citing a
// provenance file that was never written, as the reason several thousand lines
// relax seven rules; and a package README naming a dependency workspace that no
// longer exists.
//
// None of those is a failing test anywhere else, because none of them is code.
// So this walks what the repo SAYS — comments, markdown, configs, string
// literals — and holds it against what the repo HAS.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, workspaceGlobs, workspaces } from "./repo";

/** Prose and configuration, not just source: the rot lives in comments and
 *  markdown, which every other guard's reader deliberately strips. */
const SCANNED_FILE = /\.(?:tsx?|mts|cts|mjs|cjs|jsx?|jsonc?|md|ya?ml)$/;

/** Emitted by a generator, which names whatever its input named. */
const GENERATED_FILE = /(?:\.gen\.ts|worker-configuration\.d\.ts|pnpm-lock\.yaml)$/;

/**
 * Trees and files whose contents are DATA rather than claims about this repo.
 * A markdown fixture asserts bytes — its `../outside.md` is the INPUT to a
 * containment test, not a reference that can dangle.
 */
const DATA_DIR = /(?:^|\/)(?:fixtures|__fixtures__|seed)\//;
const DATA_FILES = new Map<string, string>([
  [
    "packages/editor/src/__tests__/sample-notes.ts",
    "sample note BODIES — the package names inside them are prose in a fake roadmap note, which is the input the parse is asserted against",
  ],
]);

/**
 * Names that are deliberately not things. Each is a guard's own negative
 * fixture and states why here — a blanket "ignore anything under a test" would
 * hide the real rot, which is mostly IN tests and configs.
 */
const DELIBERATE_NON_REFERENCES = new Map<string, string>([
  [
    "@repo/gone",
    "script-naming.test.ts — a workspace that is NOT there is the point of the assertion",
  ],
]);

/**
 * The scanned population is what GIT TRACKS. Deriving it from the index rather
 * than a directory walk is what keeps build output and ignored sidecars — a
 * bundled `ds-bundle/`, a `dist/` — from being read as if they were claims this
 * repo makes.
 */
function scannedFiles(): string[] {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => file.length > 0);
  return tracked.filter(
    (file) =>
      SCANNED_FILE.test(file) &&
      !GENERATED_FILE.test(file) &&
      // Dot-directories hold tooling state, the same reason every other guard
      // here skips them wholesale.
      !file.split("/").some((segment) => segment.startsWith(".")) &&
      !DATA_DIR.test(file) &&
      !DATA_FILES.has(file) &&
      // The index still lists a file deleted in the working tree; a file that
      // is gone makes no claims.
      fs.existsSync(path.join(REPO_ROOT, file)),
  );
}

interface Reference {
  text: string;
  file: string;
  line: number;
}

function referencesIn(file: string, pattern: RegExp): Reference[] {
  const found: Reference[] = [];
  const lines = fs.readFileSync(path.join(REPO_ROOT, file), "utf8").split("\n");
  lines.forEach((text, index) => {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      const captured = match[1];
      if (captured !== undefined) found.push({ text: captured, file, line: index + 1 });
      match = pattern.exec(text);
    }
  });
  return found;
}

const WORKSPACE_NAME = /(@repo\/[a-z0-9][a-z0-9-]*)/g;

/**
 * A repo-relative path, anchored on a workspace GROUP so the population is this
 * repo's own layout rather than any string with a slash in it. A glob, a
 * template hole or a trailing slash is a PATTERN, not a reference: only a claim
 * about one file or directory can dangle.
 */
function repoPathPattern(): RegExp {
  const groups = workspaceGlobs().groups.map((group) => group.replaceAll(/[^a-z0-9]/g, ""));
  return new RegExp(`((?:${groups.join("|")})\\/[A-Za-z0-9._@/-]+[A-Za-z0-9_])`, "g");
}

function danglingIn(pattern: RegExp, resolves: (text: string) => boolean): string[] {
  const dangling: string[] = [];
  for (const file of scannedFiles()) {
    for (const reference of referencesIn(file, pattern)) {
      if (resolves(reference.text)) continue;
      if (DELIBERATE_NON_REFERENCES.has(reference.text)) continue;
      dangling.push(`  ${reference.file}:${reference.line}  ${reference.text}`);
    }
  }
  return dangling;
}

describe("dangling references", () => {
  it("every @repo/* name written anywhere is a workspace that exists", () => {
    const live = new Set(workspaces().map((workspace) => workspace.name));
    const dangling = danglingIn(WORKSPACE_NAME, (text) => live.has(text));
    expect(
      dangling,
      `These name a @repo/* workspace that does not exist.\n` +
        `  rule: a package this repo writes down must be a package this repo has — a comment, README or config naming a deleted workspace is a sentence a reader will act on\n` +
        `  fix: correct the name, delete the sentence, or add it to DELIBERATE_NON_REFERENCES in tools/repo-guards/src/dangling-references.test.ts with its reason\n` +
        `${dangling.join("\n")}\n`,
    ).toEqual([]);
  });

  it("every repo-relative path written anywhere is a file or directory that exists", () => {
    const dangling = danglingIn(repoPathPattern(), (text) =>
      fs.existsSync(path.join(REPO_ROOT, text)),
    );
    expect(
      dangling,
      `These name a path under a workspace group that is not on disk.\n` +
        `  rule: a path this repo writes down must resolve — an exclusion pointing at a renamed directory excludes nothing, and the guard around it passes for the wrong reason\n` +
        `  fix: repoint it, delete the sentence, or add it to DELIBERATE_NON_REFERENCES in tools/repo-guards/src/dangling-references.test.ts with its reason\n` +
        `${dangling.join("\n")}\n`,
    ).toEqual([]);
  });

  it("no DATA_FILES or DELIBERATE_NON_REFERENCES entry outlives what it excuses", () => {
    // An allowance naming a file that is gone is the same rot one level up: it
    // reads as a considered exemption while excusing nothing.
    const missing = [...DATA_FILES.keys()].filter(
      (file) => !fs.existsSync(path.join(REPO_ROOT, file)),
    );
    expect(
      missing,
      `DATA_FILES names files that no longer exist:\n${missing.map((file) => `  ${file}`).join("\n")}`,
    ).toEqual([]);
  });
});
