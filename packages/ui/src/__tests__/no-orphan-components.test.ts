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
// re-pull it — for shadcn that is one command, and the vendored sets record
// their upstream in a PROVENANCE.md beside them.
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

/**
 * Vendored files landed ahead of the consumer that will import them. Each entry
 * is `<dir>/<name>`, and the whole list is expected to be EMPTY again once the
 * AI surface is wired up — delete the entry with the wiring, not later.
 *
 * The allowance is per file rather than per directory on purpose: a blanket
 * exemption for `src/ai` would let the next unwired component in silently,
 * which is the accumulation this guard exists to stop.
 */
const AWAITING_CONSUMER = new Set([
  "ai/approval-card",
  "ai/loading-state",
  "ai/streaming-text",
  "ai/task-rows",
  "ai/thinking",
  "ai/tool-chips",
]);

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "dist-node", "coverage"]);

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

describe("no orphan components", () => {
  it("every src/components and src/ai file has at least one consumer", () => {
    // The WHOLE repo, not a list of workspace groups. This carried
    // `["apps", "packages"]` and had already fallen behind `tools/` and `e2e`,
    // which is the shape of the bug rather than a typo: a consumer living in a
    // group nobody remembered to add reads as absent, and this guard's answer
    // to absent is "delete the component".
    const files: string[] = [];
    sourceFiles(REPO_ROOT, files);
    const contents = new Map(files.map((file) => [file, fs.readFileSync(file, "utf8")]));

    const orphans: string[] = [];
    for (const root of ROOTS) {
      const rootDir = path.join(PACKAGE_ROOT, "src", root.dir);
      if (!fs.existsSync(rootDir)) continue;
      const names = fs
        .readdirSync(rootDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
        .map((entry) => entry.name.replace(/\.tsx$/, ""));

      for (const name of names) {
        if (AWAITING_CONSUMER.has(`${root.dir}/${name}`)) continue;
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
        if (!used) orphans.push(`packages/ui/src/${root.dir}/${name}.tsx`);
      }
    }

    expect(
      orphans,
      `Unused @repo/ui components (no importer anywhere in the repo).\n` +
        `Every file under src/components and src/ai must be reachable from a consumer.\n` +
        `Delete them — a vendored set records its upstream in the PROVENANCE.md beside it,\n` +
        `and shadcn re-adds a stock component in one command — or wire them up:\n` +
        orphans.map((file) => `  ${file}`).join("\n"),
    ).toEqual([]);
  });

  it("every awaiting-consumer allowance still names an unwired file", () => {
    // The allowance is temporary by construction: once the wiring fork lands a
    // consumer, its entry here is dead weight that would hide the NEXT orphan.
    const stale: string[] = [];
    for (const entry of AWAITING_CONSUMER) {
      if (!fs.existsSync(path.join(PACKAGE_ROOT, "src", `${entry}.tsx`))) {
        stale.push(`${entry} — no such file`);
      }
    }
    expect(
      stale,
      `Stale AWAITING_CONSUMER entries in this guard.\n` +
        `Delete them:\n` +
        stale.map((entry) => `  ${entry}`).join("\n"),
    ).toEqual([]);
  });
});
