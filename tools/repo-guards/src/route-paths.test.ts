// the sweep is what the repo contains, not what it ships: smoke scripts in scripts/ are the callers
// that drift. tests are excluded on purpose: a route test that derived its URL from the contract
// could not catch the contract moving.

import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import {
  HEALTH_PATH,
  RPC_PREFIX,
  VAULT_ASSET_PATH,
  VOICE_STREAM_PATH,
} from "@repo/api/local/routes";
import { describe, expect, it } from "vitest";
import { isTestFile, sourceOf, workspaceSourceFiles, workspaces } from "./repo";

// `/ws` is absent: two characters plus a slash matches far too much ordinary prose and code.
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

// longest first, so the cloud's `/v1/vault/asset` is tried before the local `/vault/asset` it
// contains.
const GUARDED = NAMESPACES.flatMap((namespace) =>
  namespace.paths.map((path) => ({ path, home: namespace.home, use: namespace.use })),
).toSorted((left, right) => right.path.length - left.path.length);

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

// not followed by a word character or a dash, which tells `"/vault/asset?path="` from
// `"./vault/asset-route"`.
function spells(source: string, path: string): boolean {
  return new RegExp(`${path}(?![\\w-])`, "u").test(source);
}

function spellings(source: string): Spelled[] {
  return GUARDED.filter((row) => spells(source, row.path)).slice(0, 1);
}

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
