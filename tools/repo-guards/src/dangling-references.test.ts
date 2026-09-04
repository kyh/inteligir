// the other guards read source, not prose, so prose and configuration rot unwatched;
// this walks what the repo says (comments, markdown, configs, strings) against what it has.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, workspaceGlobs, workspaces } from "./repo";

const SCANNED_FILE = /\.(?:tsx?|mts|cts|mjs|cjs|jsx?|jsonc?|md|ya?ml)$/;

// emitted by a generator, which names whatever its input named.
const GENERATED_FILE = /(?:\.gen\.ts|worker-configuration\.d\.ts|pnpm-lock\.yaml)$/;

// data rather than claims: a fixture's `../outside.md` is the input to a containment test.
const DATA_DIR = /(?:^|\/)(?:fixtures|__fixtures__|seed)\//;
const DATA_FILES = new Map<string, string>([
  [
    "packages/editor/src/__tests__/sample-notes.ts",
    "sample note BODIES — the package names inside them are prose in a fake roadmap note, which is the input the parse is asserted against",
  ],
]);

// each is a guard's own negative fixture; a blanket ignore-under-tests would hide the rot, which is
// mostly in tests and configs.
const DELIBERATE_NON_REFERENCES = new Map<string, string>([
  [
    "@repo/gone",
    "script-naming.test.ts — a workspace that is NOT there is the point of the assertion",
  ],
]);

// an untracked path (dist/, .wrangler/, .dev.vars) is a fact about the machine, not the repo; asked
// from git rather than pattern-matched so the ignore rules stay in .gitignore and this guard cannot
// disagree.
function ignoredByGit(paths: readonly string[]): Set<string> {
  if (paths.length === 0) return new Set();
  // both forms: a .gitignore entry written `dist/` matches directories only, and git cannot tell
  // that a path not on disk would have been one.
  const asked = paths.flatMap((each) => [each, `${each}/`]);
  const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: REPO_ROOT,
    input: asked.join("\0"),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // exit 1 means none are ignored.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed: ${result.stderr}`);
  }
  const ignored = new Set<string>();
  for (const each of result.stdout.split("\0")) {
    if (each.length > 0) ignored.add(each.replace(/\/$/, ""));
  }
  return ignored;
}

// git's index, not a directory walk, so build output and ignored sidecars are not read as claims.
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
      // dot-directories hold tooling state.
      !file.split("/").some((segment) => segment.startsWith(".")) &&
      !DATA_DIR.test(file) &&
      !DATA_FILES.has(file) &&
      // the index still lists a file deleted in the working tree.
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

// anchored on a workspace group so the population is this repo's layout, not any string with a
// slash; a glob, a template hole or a trailing slash is a pattern, not a reference.
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
    const referenced = danglingIn(repoPathPattern(), (text) =>
      fs.existsSync(path.join(REPO_ROOT, text)),
    );
    // node_modules/ sits behind a symlink check-ignore refuses to walk, so it is answered here.
    const named = referenced.map((line) => line.trim().split(/\s+/).slice(1).join(" "));
    const ignored = ignoredByGit(named.filter((text) => !text.includes("node_modules/")));
    const dangling = referenced.filter((line, index) => {
      const text = named[index] ?? "";
      return !text.includes("node_modules/") && !ignored.has(text);
    });
    expect(
      dangling,
      `These name a path under a workspace group that is not on disk.\n` +
        `  rule: a path this repo writes down must resolve — an exclusion pointing at a renamed directory excludes nothing, and the guard around it passes for the wrong reason\n` +
        `  fix: repoint it, delete the sentence, or add it to DELIBERATE_NON_REFERENCES in tools/repo-guards/src/dangling-references.test.ts with its reason\n` +
        `${dangling.join("\n")}\n`,
    ).toEqual([]);
  });

  it("no DATA_FILES or DELIBERATE_NON_REFERENCES entry outlives what it excuses", () => {
    const missing = [...DATA_FILES.keys()].filter(
      (file) => !fs.existsSync(path.join(REPO_ROOT, file)),
    );
    expect(
      missing,
      `DATA_FILES names files that no longer exist:\n${missing.map((file) => `  ${file}`).join("\n")}`,
    ).toEqual([]);
  });
});
