// the sweep is what the repo contains, not what it ships: smoke scripts in scripts/ are the callers
// that drift. tests are excluded on purpose: a route test that derived its URL from the contract
// could not catch the contract moving.

import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { V1_RPC_PATH } from "@repo/contract/v1";
import { describe, expect, it } from "vitest";
import { isTestFile, sourceOf, workspaceSourceFiles, workspaces } from "./repo";

// a `quoted` path is a word module paths hold too (`@repo/contract/library/…`), so it counts only
// where a string or a route pattern starts with it.
interface Namespace {
  readonly home: string;
  readonly paths: readonly string[];
  readonly use: string;
  readonly quoted?: boolean;
}

const NAMESPACES: readonly Namespace[] = [
  {
    home: "packages/contract/src/v1-contract.ts",
    paths: [V1_RPC_PATH],
    use: "V1_RPC_PATH from @repo/contract/v1",
  },
  {
    home: "packages/contract/src/library-page.ts",
    paths: [LIBRARY_PAGE_PATH],
    quoted: true,
    use: "LIBRARY_PAGE_PATH from @repo/contract/library-page",
  },
];

// longest first, so a path is matched before any shorter one it contains
const GUARDED = NAMESPACES.flatMap((namespace) =>
  namespace.paths.map((path) => ({
    home: namespace.home,
    path,
    quoted: namespace.quoted === true,
    use: namespace.use,
  })),
).toSorted((left, right) => right.path.length - left.path.length);

// a caller that cannot import the contract, keyed by file, with why it cannot
const ELSEWHERE = new Map([
  [
    "apps/web/src/routeTree.gen.ts",
    "the site router's route tree, generated from apps/web/src/routes, which every typed route spelling is checked against",
  ],
]);

// a route the site's router types (its file route, a match's `from`, a navigation's `to`) fails
// the typecheck once its file moves, so it is no second spelling
const TYPED_ROUTE =
  /\b(?:createFileRoute|getRouteApi)\(\s*["'`]\/[^"'`]*["'`]|\b(?:from|to):\s*["'`]\/[^"'`]*["'`]/gu;

interface Spelled {
  path: string;
  quoted: boolean;
  home: string;
  use: string;
}

interface Hit extends Spelled {
  file: string;
}

// not followed by a word character or a dash, which tells `"/library?item="` from `"/library-page"`
const spells = (source: string, { path, quoted }: Pick<Spelled, "path" | "quoted">): boolean =>
  new RegExp(`${quoted ? "[\"'`!]" : ""}${path}(?![\\w-])`, "u").test(source);

const spellings = (source: string): Spelled[] => {
  const untyped = source.replaceAll(TYPED_ROUTE, "");
  return GUARDED.filter((row) => spells(untyped, row)).slice(0, 1);
};

const sweptFiles = (): string[] =>
  workspaces()
    .flatMap((workspace) => workspaceSourceFiles(workspace))
    .filter((file) => !isTestFile(file))
    .toSorted();

const hits = (files: readonly string[]): Hit[] =>
  files.flatMap((file) => spellings(sourceOf(file)).map((row) => ({ ...row, file })));

describe("one spelling per non-procedure route path", () => {
  const files = sweptFiles();

  it("finds every home and the tree they are held against", () => {
    for (const row of GUARDED) {
      expect(row.path.startsWith("/"), `not a path: "${row.path}"`).toBe(true);
    }
    expect(
      files,
      "the sweep does not reach scripts/, which is where the smokes that spell paths live",
    ).toContain("apps/desktop/scripts/smoke-packaged.ts");
    for (const namespace of NAMESPACES) {
      expect(files, `the sweep found no ${namespace.home} — it is broken, not the tree`).toContain(
        namespace.home,
      );
      expect(spellings(sourceOf(namespace.home))).toHaveLength(1);
    }
  });

  it("nothing outside the contract writes one as a literal", () => {
    const violations: string[] = [];
    for (const hit of hits(files)) {
      if (hit.file === hit.home) {
        continue;
      }
      if (ELSEWHERE.has(hit.file)) {
        continue;
      }
      violations.push(
        `HAND-SPELLED ROUTE PATH  ${hit.file}\n` +
          `  found: the literal "${hit.path}…"\n` +
          `  rule: every path a server answers outside its RPC handler lives in ${hit.home}; a caller holding its own copy keeps dialing the old one after it moves, and finds out at runtime\n` +
          `  fix: use ${hit.use} — or add a row to ELSEWHERE in tools/repo-guards/src/route-paths.test.ts saying why this caller cannot import the contract`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toStrictEqual([]);
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
    expect(stale, `\n${stale.join("\n\n")}\n`).toStrictEqual([]);
  });
});
