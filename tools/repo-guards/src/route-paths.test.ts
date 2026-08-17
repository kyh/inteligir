// ---------------------------------------------------------------------------
// One place spells an API route path.
//
// The route table is the contract, and the typed client composes its URLs from
// it — but four production callers reach the server without that client (a
// discovery probe, an identity challenge, an `<img src>`, an env-var's own help
// text), and each had written the path out by hand. Both halves of a URL move:
// `API_BASE_PATH` is a version prefix, and a row's `path` is edited in the
// table. A hand-written `/api/v1/system/status` survives either edit unchanged
// and fails at runtime, on the one code path whose whole job is deciding
// whether the thing that answered is the server this checkout means.
//
// So the rule: outside the contract, nothing composes an API URL out of
// literals. `apiPath(apiRoutes.<row>)` is the one spelling, and it takes BOTH
// halves from the table — a half-derived `${API_BASE_PATH}/vault/asset` is the
// same bug wearing the prefix, so it is caught as its own shape.
//
// The sweep is over what the repo CONTAINS, not what it ships: the smoke
// scripts live in `scripts/` and are exactly the kind of caller that drifts.
// Test files are excluded on purpose and not by accident — a route test that
// derived its URL from the table could not catch the table moving, so spelling
// the wire out is what those files are FOR.
// ---------------------------------------------------------------------------

import { API_BASE_PATH } from "@repo/server-contract/routes";
import { describe, expect, it } from "vitest";
import { isTestFile, sourceOf, workspaceSourceFiles, workspaces } from "./repo";

/** The file that declares the mount point, and therefore the one that must
 *  spell it. Everything else derives. */
const HOME = "packages/server-contract/src/routes.ts";
const USE = "apiPath(apiRoutes.<row>) from @repo/server-contract/routes";

/**
 * Files allowed to spell a path anyway, and why. Each is drained below: a row
 * whose file no longer matches fails, so an exemption cannot outlive its
 * reason.
 */
const ELSEWHERE: Record<string, string> = {
  "apps/launcher/scripts/smoke.mjs":
    "a plain .mjs script run by `node` against a PACKED tarball in a scratch prefix — it has no bundler, no TypeScript and no workspace link to import the contract through, and giving it one would mean shipping the contract inside the published artifact to satisfy a test",
  "apps/desktop/scripts/smoke-packaged.mjs":
    "the same, one layer further out: it drives the packaged .app's own Electron binary as a bare node process, so the only module it can import is the one the artifact itself publishes (inteligir/scripts/staged-layout.mjs)",
};

interface Hit {
  file: string;
  what: string;
}

/** The two shapes a hand-written API URL takes: the whole path as a literal,
 *  and the prefix derived with the row's half still spelled out. */
function spellings(source: string): string[] {
  const found: string[] = [];
  if (source.includes(API_BASE_PATH)) {
    found.push(`the literal "${API_BASE_PATH}…"`);
  }
  const halfDerived = /API_BASE_PATH\s*\}\s*\/|API_BASE_PATH\s*\+\s*["'`]\//.exec(source);
  if (halfDerived !== null) {
    found.push(`API_BASE_PATH joined to a hand-written row path (${halfDerived[0].trim()}…)`);
  }
  return found;
}

/** Every non-test source file the repo holds. */
function sweptFiles(): string[] {
  return workspaces()
    .flatMap((workspace) => workspaceSourceFiles(workspace))
    .filter((file) => !isTestFile(file))
    .toSorted();
}

function hits(files: readonly string[]): Hit[] {
  return files.flatMap((file) => spellings(sourceOf(file)).map((what) => ({ file, what })));
}

describe("one spelling per API route path", () => {
  const files = sweptFiles();

  it("finds the home and the tree it is held against", () => {
    // A base path that read as empty would match every file; a sweep that
    // missed the scripts would silently stop covering the callers this guard
    // was written for. Both are checked, because both fail by finding nothing.
    expect(API_BASE_PATH.startsWith("/"), `API_BASE_PATH is not a path: "${API_BASE_PATH}"`).toBe(
      true,
    );
    expect(files, `the sweep found no ${HOME} — it is broken, not the tree`).toContain(HOME);
    expect(
      files,
      "the sweep does not reach scripts/, which is where the smokes that spell paths live",
    ).toContain("apps/launcher/scripts/smoke.mjs");
    expect(spellings(sourceOf(HOME)).length, `${HOME} no longer spells the mount point`).toBe(1);
  });

  it("nothing outside the contract composes an API URL from literals", () => {
    const violations: string[] = [];
    for (const hit of hits(files)) {
      if (hit.file === HOME) continue;
      if (ELSEWHERE[hit.file] !== undefined) continue;
      violations.push(
        `HAND-SPELLED ROUTE PATH  ${hit.file}\n` +
          `  found: ${hit.what}\n` +
          `  rule: the mount point and every row path live in ${HOME}; a caller holding its own copy keeps answering the old URL after either half moves, and finds out at runtime\n` +
          `  fix: use ${USE} — or add a row to ELSEWHERE in tools/repo-guards/src/route-paths.test.ts saying why this caller cannot import the contract`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("no ELSEWHERE row is stale", () => {
    const matched = new Set(hits(files).map((hit) => hit.file));
    const stale = Object.entries(ELSEWHERE)
      .filter(([file]) => !matched.has(file))
      .map(
        ([file, why]) =>
          `STALE EXCEPTION  ${file}\n` +
          `  it no longer spells an API path, so the reason it carried is spent\n` +
          `  the reason was: ${why}\n` +
          `  fix: delete the row from ELSEWHERE in tools/repo-guards/src/route-paths.test.ts`,
      );
    expect(stale, `\n${stale.join("\n\n")}\n`).toEqual([]);
  });
});
