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

/** `[text](dest)` / `![alt](dest)`, tolerating `<dest>` and a `"title"`. */
const MD_LINK = /\[[^\]]*\]\(\s*<?([^)<>\s]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** Anything with a URI scheme (http, mailto, inteligir, vault-app, ws…). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

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

/** Drop fenced blocks and inline code spans: a `[]()` inside either is being
 * shown, not asserted. Line-based rather than one regex so an unterminated
 * fence at EOF degrades to "rest of file is code" instead of matching nothing.
 * Inline stripping is single-line and single-backtick — good enough, because a
 * miss only re-admits a link, and a real link is what we want to check. */
function stripCode(markdown: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null) {
      if (marker === undefined) out.push(line.replace(/`[^`\n]*`/g, ""));
      else {
        fence = marker;
        out.push("");
      }
      continue;
    }
    // A closing fence is the same character, at least as long as the opener.
    if (
      marker !== undefined &&
      marker.length >= fence.length &&
      marker.startsWith(fence.slice(0, 1))
    ) {
      fence = null;
    }
    out.push("");
  }
  return out.join("\n");
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
      const body = stripCode(fs.readFileSync(file, "utf8"));
      for (const match of body.matchAll(MD_LINK)) {
        const raw = match[1];
        if (raw === undefined || raw.startsWith("#") || HAS_SCHEME.test(raw)) continue;
        // Drop a `#heading` fragment; a pure fragment already left above.
        const target = decodeURIComponent(raw.split("#")[0] ?? "");
        if (target === "") continue;
        checked += 1;
        // A leading `/` means repo root here — GitHub would resolve it at the
        // site root, i.e. off the repo entirely, so either reading is a bug.
        const resolved = target.startsWith("/")
          ? path.join(REPO_ROOT, target)
          : path.resolve(path.dirname(file), target);
        if (!fs.existsSync(resolved)) broken.push(`${repoRelative(file)} → ${raw}`);
      }
    }

    // Floors, so a regex or walk regression can't quietly make this vacuous.
    expect(scanned.length).toBeGreaterThan(20);
    expect(checked).toBeGreaterThan(10);
    expect(
      broken,
      `Markdown links pointing at files that do not exist — fix the path, write ` +
        `the file, or drop the link:\n${broken.join("\n")}`,
    ).toEqual([]);
  });
});
