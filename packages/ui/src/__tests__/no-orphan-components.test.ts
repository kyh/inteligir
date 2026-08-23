// ---------------------------------------------------------------------------
// Orphan-component guard: every file under src/components and src/ai must be
// reachable from a consumer — another workspace importing
// `@repo/ui/components/<name>` or `@repo/ui/ai/<name>`, or another file inside
// this package.
//
// This exists because `knip` structurally CANNOT check it. The package's
// exports map wildcards `./components/*` and `./ai/*`, which makes every
// component a public entry point, so knip treats an orphan as intentional API
// and stays silent — it did, through several convergence sweeps, while 31
// unused vendored components (~3,800 lines) accumulated and pinned 5 npm
// dependencies.
//
// Mirrors the repo's other source-walk invariants (teardown-completeness,
// kit-parity, pi-quarantine): assert the architectural rule as a failing test.
//
// Adding a component you have not wired up yet? Wire it up, or delete it and
// re-pull it — for shadcn that is one command.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");

/** The swept roots, each with the subpath its exports-map wildcard publishes.
 *  Derived rather than hardcoded per test, so a new component directory is one
 *  row here and the failure text follows automatically. */
const ROOTS = [
  { dir: "components", subpath: "components" },
  { dir: "ai", subpath: "ai" },
] as const;

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "dist-node", "coverage"]);

/**
 * The component gallery (`/gallery`) imports EVERY component by design, so
 * counting it as a consumer would answer this guard's question before it was
 * asked — every component would look wired forever, which is exactly the
 * silence that let 31 orphans accumulate.
 *
 * A gallery proves a component RENDERS, not that the product NEEDS it. Those
 * are different claims and only the second one keeps a component alive.
 */
const NON_CONSUMER_DIRS = [path.join(REPO_ROOT, "apps", "app", "src", "app", "gallery")];

function isNonConsumer(file: string): boolean {
  return NON_CONSUMER_DIRS.some((dir) => file.startsWith(dir + path.sep));
}

/** Dot-directories are skipped wholesale: they hold tooling state, ignored
 * sidecars, and agent worktrees — whole checkouts of this repo, which a walk
 * would read as if they were this commit's tree. */
function isSkippedDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIR_NAMES.has(name);
}

/** Every source file in the repo that could import a component, excluding the
 * component files themselves (a component importing a sibling keeps it alive,
 * so those ARE included — see `intraPackage` below). */
function sourceFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) continue;
      sourceFiles(path.join(dir, entry.name), out);
    } else if (/\.(tsx?|mdx?|css)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
}

/**
 * The Beautiful UI set was vendored WHOLE at the owner's request ("make sure
 * we have all the components"), and fourteen of them have no product surface
 * yet — only the gallery, which this guard deliberately does not count.
 *
 * Named per file rather than by directory, so the fifteenth unwired component
 * still fails. Delete an entry the moment its component is wired; the test
 * below fails if an entry outlives its file, so this cannot rot silently.
 */
const AWAITING_CONSUMER = new Set([
  "packages/ui/src/ai/chat.tsx",
  "packages/ui/src/ai/code-block.tsx",
  "packages/ui/src/ai/context-cards.tsx",
  "packages/ui/src/ai/diff-table.tsx",
  "packages/ui/src/ai/filter-table.tsx",
  "packages/ui/src/ai/fine-tune-card.tsx",
  "packages/ui/src/ai/flowchart.tsx",
  "packages/ui/src/ai/insight-cards.tsx",
  "packages/ui/src/ai/prompt-bar.tsx",
  "packages/ui/src/ai/recommendation-card.tsx",
  "packages/ui/src/ai/records-table.tsx",
  "packages/ui/src/ai/search.tsx",
  "packages/ui/src/ai/selection-actions.tsx",
  "packages/ui/src/ai/sidebar-nav.tsx",
]);

describe("no orphan components", () => {
  it("every src/components and src/ai file has at least one consumer", () => {
    // The WHOLE repo, not a list of workspace groups. This carried
    // `["apps", "packages"]` and had already fallen behind `tools/` and `e2e`,
    // which is the shape of the bug rather than a typo: a consumer living in a
    // group nobody remembered to add reads as absent, and this guard's answer
    // to absent is "delete the component".
    const files: string[] = [];
    sourceFiles(REPO_ROOT, files);
    const contents = new Map(
      files
        .filter((file) => !isNonConsumer(file))
        .map((file) => [file, fs.readFileSync(file, "utf8")]),
    );

    const orphans: string[] = [];
    for (const root of ROOTS) {
      const rootDir = path.join(PACKAGE_ROOT, "src", root.dir);
      if (!fs.existsSync(rootDir)) continue;
      const names = fs
        .readdirSync(rootDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
        .map((entry) => entry.name.replace(/\.tsx$/, ""));

      for (const name of names) {
        const selfPath = path.join(rootDir, `${name}.tsx`);
        let used = false;
        for (const [file, content] of contents) {
          if (file === selfPath) continue;
          // Cross-workspace: `@repo/ui/<subpath>/<name>`.
          if (content.includes(`@repo/ui/${root.subpath}/${name}"`)) {
            used = true;
            break;
          }
          // Intra-package: a sibling or a hook importing `./<name>`.
          const intraPackage = file.startsWith(path.join(PACKAGE_ROOT, "src") + path.sep);
          if (intraPackage && new RegExp(`from "\\.{1,2}(/${root.dir})?/${name}"`).test(content)) {
            used = true;
            break;
          }
        }
        const relative = `packages/ui/src/${root.dir}/${name}.tsx`;
        if (!used && !AWAITING_CONSUMER.has(relative)) orphans.push(relative);
      }
    }

    expect(
      orphans,
      `Unused @repo/ui components (no importer anywhere in the repo).\n` +
        `Every file under src/components and src/ai must be reachable from a consumer.\n` +
        `The component gallery does NOT count as one — it imports everything by design,\n` +
        `and rendering in a gallery is not the same claim as the product needing it.\n` +
        `Delete them — shadcn re-adds a stock component in one command — or wire them up:\n` +
        orphans.map((file) => `  ${file}`).join("\n"),
    ).toEqual([]);
  });
  it("no AWAITING_CONSUMER entry outlives its file", () => {
    // The allowance is a promise to wire these, not a place to hide a deleted
    // path. An entry naming a file that no longer exists means the list was
    // not maintained, which is how an allowance becomes permanent.
    const missing = [...AWAITING_CONSUMER].filter(
      (relative) => !fs.existsSync(path.join(REPO_ROOT, relative)),
    );
    expect(
      missing,
      `AWAITING_CONSUMER names files that do not exist:\n${missing.map((file) => `  ${file}`).join("\n")}`,
    ).toEqual([]);
  });
});
