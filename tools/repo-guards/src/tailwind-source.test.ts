// Every `@source` glob's static base directory must exist. Tailwind's scanner
// answers a missing base with zero files — no error, no warning — so the
// utilities that stylesheet was meant to generate silently never exist
// (proven: the app's editor-package `@source` was mis-rooted for weeks and
// callout accents, wiki pills and gutter offsets never rendered, on screen
// and in prod alike).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, isSkippedDir, workspaces } from "./repo";

function cssFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) continue;
      cssFiles(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".css")) {
      out.push(path.join(dir, entry.name));
    }
  }
}

/**
 * `@source` rows a stylesheet can carry. `inline(...)` embeds candidates
 * directly (no path to check); `not "..."` still names a path whose base must
 * exist — an excluded dir that is not there is the same silent no-op.
 */
const SOURCE_ROW = /@source\s+(?:not\s+)?"([^"]+)"/g;
const SOURCE_INLINE = /@source\s+inline\(/;

/** The glob's static prefix: everything before the first segment that
 *  contains a wildcard or brace. */
function staticBase(glob: string): string {
  const segments = glob.split("/");
  const fixed: string[] = [];
  for (const segment of segments) {
    if (/[*?{[]/.test(segment)) break;
    fixed.push(segment);
  }
  return fixed.join("/");
}

describe("tailwind @source bases", () => {
  it("every @source glob resolves to a directory that exists", () => {
    const files: string[] = [];
    for (const workspace of workspaces()) {
      cssFiles(path.join(REPO_ROOT, workspace.dir), files);
    }

    const violations: string[] = [];
    for (const file of files.toSorted()) {
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        if (SOURCE_INLINE.test(line)) continue;
        for (const match of line.matchAll(SOURCE_ROW)) {
          const glob = match[1];
          if (glob === undefined) continue;
          const base = staticBase(glob);
          const resolved = path.resolve(path.dirname(file), base);
          if (!fs.existsSync(resolved)) {
            violations.push(
              `${path.relative(REPO_ROOT, file)} — @source "${glob}" → ${path.relative(REPO_ROOT, resolved)} does not exist`,
            );
          }
        }
      }
    }

    expect(
      violations,
      violations.length === 0
        ? ""
        : `MISSING @source BASE DIRECTORIES\n` +
            violations.map((line) => `  ${line}`).join("\n") +
            `\n  rule: Tailwind treats a missing @source base as an empty scan — no error, no utilities — so the base directory must exist relative to the stylesheet`,
    ).toEqual([]);
  });
});
