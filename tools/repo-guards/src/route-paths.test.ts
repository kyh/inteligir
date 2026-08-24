// ---------------------------------------------------------------------------
// One place spells a non-procedure route path.
//
// Every PROCEDURE is addressed by its position in the contract router, so its
// path stopped existing — there is nothing left to hand-spell. What remains is
// the small set of routes that are deliberately not procedures: the RPC mount
// itself, the health probe, the vault's asset bytes, and the two websockets.
// Those still have paths, and several callers reach them without a typed
// client — a supervisor's probe, a socket dial, a smoke script, an env var's
// own help text — and each is exactly the caller that drifts.
//
// So the rule: outside the module that declares them, nothing writes one of
// those paths as a literal. `@repo/api/local/routes` is the one spelling.
//
// The sweep is over what the repo CONTAINS, not what it ships: the smoke
// scripts live in `scripts/` and are exactly the kind of caller that drifts.
// Test files are excluded on purpose and not by accident — a route test that
// derived its URL from the contract could not catch the contract moving, so
// spelling the wire out is what those files are FOR.
// ---------------------------------------------------------------------------

import {
  HEALTH_PATH,
  RPC_PREFIX,
  VAULT_ASSET_PATH,
  VOICE_STREAM_PATH,
} from "@repo/api/local/routes";
import { describe, expect, it } from "vitest";
import { isTestFile, sourceOf, workspaceSourceFiles, workspaces } from "./repo";

/** The file that declares the paths, and therefore the one that must spell
 *  them. Everything else imports. */
const HOME = "packages/api/src/local/local-routes.ts";
const USE = "the constants in @repo/api/local/routes";

/**
 * The paths under guard, longest first so a hit reports the most specific one.
 * `/ws` is deliberately absent: two characters plus a slash matches far too
 * much ordinary prose and code to be a signal.
 */
const GUARDED_PATHS = [VOICE_STREAM_PATH, VAULT_ASSET_PATH, HEALTH_PATH, RPC_PREFIX].toSorted(
  (left, right) => right.length - left.length,
);

/**
 * Files allowed to spell a path anyway, and why. Each is drained below: a row
 * whose file no longer matches fails, so an exemption cannot outlive its
 * reason.
 */
const ELSEWHERE = new Map<string, string>([
  [
    "apps/cli/scripts/smoke.mjs",
    "a plain .mjs script run by `node` against a PACKED tarball in a scratch prefix — it has no bundler, no TypeScript and no workspace link to import the contract through, and giving it one would mean shipping the contract inside the published artifact to satisfy a test",
  ],
  [
    "apps/desktop/scripts/smoke-packaged.mjs",
    "the same, one layer further out: it drives the packaged .app's own Electron binary as a bare node process, with no module resolution into this workspace at all",
  ],
]);

interface Hit {
  file: string;
  what: string;
}

/** A path is spelled when it appears NOT followed by a word character or a
 *  dash — which is what tells `"/vault/asset?path="` from the module specifier
 *  `"./vault/asset-route"`. */
function spells(source: string, path: string): boolean {
  return new RegExp(`${path}(?![\\w-])`, "u").test(source);
}

function spellings(source: string): string[] {
  return GUARDED_PATHS.filter((path) => spells(source, path))
    .map((path) => `the literal "${path}…"`)
    .slice(0, 1);
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

describe("one spelling per non-procedure route path", () => {
  const files = sweptFiles();

  it("finds the home and the tree it is held against", () => {
    // A path that read as empty would match every file; a sweep that missed
    // the scripts would silently stop covering the callers this guard was
    // written for. Both are checked, because both fail by finding nothing.
    for (const path of GUARDED_PATHS) {
      expect(path.startsWith("/"), `not a path: "${path}"`).toBe(true);
    }
    expect(files, `the sweep found no ${HOME} — it is broken, not the tree`).toContain(HOME);
    expect(
      files,
      "the sweep does not reach scripts/, which is where the smokes that spell paths live",
    ).toContain("apps/cli/scripts/smoke.mjs");
    expect(spellings(sourceOf(HOME)).length, `${HOME} no longer spells a route path`).toBe(1);
  });

  it("nothing outside the contract writes one as a literal", () => {
    const violations: string[] = [];
    for (const hit of hits(files)) {
      if (hit.file === HOME) continue;
      if (ELSEWHERE.has(hit.file)) continue;
      violations.push(
        `HAND-SPELLED ROUTE PATH  ${hit.file}\n` +
          `  found: ${hit.what}\n` +
          `  rule: every path this server answers outside the RPC handler lives in ${HOME}; a caller holding its own copy keeps dialing the old one after it moves, and finds out at runtime\n` +
          `  fix: use ${USE} — or add a row to ELSEWHERE in tools/repo-guards/src/route-paths.test.ts saying why this caller cannot import the contract`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("no ELSEWHERE row is stale", () => {
    const matched = new Set(hits(files).map((hit) => hit.file));
    const stale = [...ELSEWHERE]
      .filter(([file]) => !matched.has(file))
      .map(
        ([file, why]) =>
          `STALE EXCEPTION  ${file}\n` +
          `  it no longer spells a route path, so the reason it carried is spent\n` +
          `  the reason was: ${why}\n` +
          `  fix: delete the row from ELSEWHERE in tools/repo-guards/src/route-paths.test.ts`,
      );
    expect(stale, `\n${stale.join("\n\n")}\n`).toEqual([]);
  });
});
