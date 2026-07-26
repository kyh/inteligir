// ---------------------------------------------------------------------------
// Broken-relative-link guard for the repo's markdown. Docs are the one surface
// with no compiler: a `[](./path)` aimed at a file that does not exist reads
// as authoritative and survives review after review, because nothing checks
// it. Every other structural invariant here is machine-checked (teardown
// completeness, dispatch gating, the pi quarantine, kit parity) — this is that
// treatment for `[]()`.
//
// It lives in @repo/server, not @repo/notes or @repo/bridge, because both of
// those are lint-banned from importing `node:*` (they are the platform-neutral
// seam) and this walk needs the filesystem. packages/server is already where
// the repo-wide derived tests live, and it needs no manifest change to run.
//
// Extraction is the vault's own `scanDoc` rather than a bespoke regex: it is
// the tested extractor this repo already ships and depends on, it hands back
// every destination percent-decoded with the `#fragment` split off and
// external/scheme/fragment-only ones already dropped, and it excludes fenced
// blocks and inline code for free — micromark never runs text constructs
// inside them. It also reports the source LINE, so a failure names the line to
// fix. Wiki links are skipped: `[[target]]` is vault syntax resolved against a
// vault, not a path relative to the file it sits in.
//
// Scope is deliberately narrow — markdown LINK DESTINATIONS only. Backtick-
// quoted paths are the more common citation form in these docs and rot the same
// way, but a backtick span also carries command names, globs, vault-relative
// paths, package specifiers and symbol names; separating those needs a
// maintained exception list, which rots in turn. A link destination is
// unambiguous, so that is what gets checked.
//
// The walk is the filesystem, not `git ls-files` (same as the sibling derived
// tests, and it keeps this free of a child process). CI checks out clean so it
// sees exactly the tracked tree; locally an untracked scratch `.md` with a dead
// link will also fail — accepted, since the repo already bans stray plan files.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { scanDoc } from "@repo/notes/knowledge/link-extract";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "out",
  "coverage",
  ".git",
  ".cache",
  ".turbo",
  ".output",
  ".expo",
  ".wrangler",
  ".tanstack",
]);

/** The byte-pinned round-trip corpus. Those files are editor INPUT, not
 * documentation — their links are content under test (deliberately dangling
 * `assets/*.png` among them) and their bytes may never be touched. */
const SKIP_PREFIX = "apps/desktop/src/renderer/__tests__/fixtures/";

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR_NAMES.has(entry.name)) walk(full, out);
    } else if (entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
}

function repoRelative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

describe("docs links", () => {
  it("every relative markdown link resolves to a file that exists", () => {
    const files: string[] = [];
    walk(REPO_ROOT, files);
    const scanned = files.filter((file) => !repoRelative(file).startsWith(SKIP_PREFIX)).toSorted();

    const broken: string[] = [];
    let checked = 0;
    for (const file of scanned) {
      for (const link of scanDoc(fs.readFileSync(file, "utf8")).links) {
        if (link.kind === "wiki") continue;
        checked += 1;
        // A leading `/` means repo root here — GitHub would resolve it at the
        // site root, i.e. off the repo entirely, so either reading is a bug.
        const resolved = link.target.startsWith("/")
          ? path.join(REPO_ROOT, link.target)
          : path.resolve(path.dirname(file), link.target);
        if (!fs.existsSync(resolved)) {
          broken.push(`${repoRelative(file)}:${link.line} → ${link.target}`);
        }
      }
    }

    // Floors, so an extraction or walk regression can't quietly make this
    // vacuous.
    expect(scanned.length).toBeGreaterThan(20);
    expect(checked).toBeGreaterThan(10);
    expect(
      broken,
      `Markdown links pointing at files that do not exist — fix the path, write ` +
        `the file, or drop the link:\n${broken.join("\n")}`,
    ).toEqual([]);
  });
});
