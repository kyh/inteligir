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

import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import {
  HEALTH_PATH,
  RPC_PREFIX,
  VAULT_ASSET_PATH,
  VOICE_STREAM_PATH,
} from "@repo/api/local/routes";
import { describe, expect, it } from "vitest";
import { isTestFile, sourceOf, workspaceSourceFiles, workspaces } from "./repo";

/**
 * Each namespace's paths and the module that declares them. TWO homes, because
 * there are two servers: the local app's non-procedure routes, and the cloud's
 * vault read rows — a wire a deployed Worker answers for installs that may be
 * months stale, so a caller holding its own copy of one is worse here, not
 * better.
 *
 * `/ws` is deliberately absent: two characters plus a slash matches far too
 * much ordinary prose and code to be a signal.
 */
const NAMESPACES = [
  {
    home: "packages/api/src/local/local-routes.ts",
    use: "the constants in @repo/api/local/routes",
    paths: [VOICE_STREAM_PATH, VAULT_ASSET_PATH, HEALTH_PATH, RPC_PREFIX],
  },
  {
    home: "packages/api/src/cloud/vault/vault-schema.ts",
    use: "VAULT_API_PATHS from @repo/api/cloud/vault/vault-schema",
    paths: Object.values(VAULT_API_PATHS),
  },
];

/** Longest first, so a hit reports the most specific path — and so the
 *  cloud's `/v1/vault/asset` is tried before the local `/vault/asset` it
 *  contains. */
const GUARDED = NAMESPACES.flatMap((namespace) =>
  namespace.paths.map((path) => ({ path, home: namespace.home, use: namespace.use })),
).toSorted((left, right) => right.path.length - left.path.length);

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

interface Spelled {
  path: string;
  home: string;
  use: string;
}

interface Hit extends Spelled {
  file: string;
}

/** A path is spelled when it appears NOT followed by a word character or a
 *  dash — which is what tells `"/vault/asset?path="` from the module specifier
 *  `"./vault/asset-route"`. */
function spells(source: string, path: string): boolean {
  return new RegExp(`${path}(?![\\w-])`, "u").test(source);
}

/** The most specific path this source spells, with the home that owns it.
 *  One hit: the first is the most specific, and a file that spells two has
 *  one thing to fix either way. */
function spellings(source: string): Spelled[] {
  return GUARDED.filter((row) => spells(source, row.path)).slice(0, 1);
}

/** Every non-test source file the repo holds. */
function sweptFiles(): string[] {
  return workspaces()
    .flatMap((workspace) => workspaceSourceFiles(workspace))
    .filter((file) => !isTestFile(file))
    .toSorted();
}

function hits(files: readonly string[]): Hit[] {
  return files.flatMap((file) =>
    spellings(sourceOf(file)).map((row) => ({
      file,
      path: row.path,
      home: row.home,
      use: row.use,
    })),
  );
}

describe("one spelling per non-procedure route path", () => {
  const files = sweptFiles();

  it("finds every home and the tree they are held against", () => {
    // A path that read as empty would match every file; a sweep that missed
    // the scripts would silently stop covering the callers this guard was
    // written for. Both are checked, because both fail by finding nothing.
    for (const row of GUARDED) {
      expect(row.path.startsWith("/"), `not a path: "${row.path}"`).toBe(true);
    }
    expect(
      files,
      "the sweep does not reach scripts/, which is where the smokes that spell paths live",
    ).toContain("apps/cli/scripts/smoke.mjs");
    for (const namespace of NAMESPACES) {
      expect(files, `the sweep found no ${namespace.home} — it is broken, not the tree`).toContain(
        namespace.home,
      );
      expect(
        spellings(sourceOf(namespace.home)).length,
        `${namespace.home} no longer spells a route path`,
      ).toBe(1);
    }
  });

  it("nothing outside the contract writes one as a literal", () => {
    const violations: string[] = [];
    for (const hit of hits(files)) {
      if (hit.file === hit.home) continue;
      if (ELSEWHERE.has(hit.file)) continue;
      violations.push(
        `HAND-SPELLED ROUTE PATH  ${hit.file}\n` +
          `  found: the literal "${hit.path}…"\n` +
          `  rule: every path a server answers outside its RPC handler lives in ${hit.home}; a caller holding its own copy keeps dialing the old one after it moves, and finds out at runtime\n` +
          `  fix: use ${hit.use} — or add a row to ELSEWHERE in tools/repo-guards/src/route-paths.test.ts saying why this caller cannot import the contract`,
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
