// ---------------------------------------------------------------------------
// Orphan-component guard: every file under src/components must be reachable
// from a consumer — another workspace importing `@repo/ui/components/<name>`,
// or another file inside this package.
//
// This exists because `knip` structurally CANNOT check it. The package's
// exports map wildcards `./components/*`, which makes every component a public
// entry point, so knip treats an orphan as intentional API and stays silent —
// it did, through several convergence sweeps, while 31 unused vendored
// components (~3,800 lines) accumulated and pinned 5 npm dependencies.
//
// Mirrors the repo's other source-walk invariants (teardown-completeness,
// kit-parity, pi-quarantine): assert the architectural rule as a failing test.
//
// Adding a component you have not wired up yet? Wire it up, or delete it and
// re-pull it from shadcn when you actually need it — that is one command.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const COMPONENTS_DIR = path.join(PACKAGE_ROOT, "src", "components");

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "dist-node", "coverage"]);

/** Dot-directories are skipped wholesale: they hold tooling state, ignored
 * sidecars, and agent worktrees — whole checkouts of this repo, which a walk
 * would read as if they were this commit's tree. */
function isSkippedDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIR_NAMES.has(name);
}

// Carried ahead of their v3 consumers (issue #542): the package rides through
// the rewrite whole, so these components have no importer YET. Strike a name
// off as a v3 surface consumes it; a component that v3 never picks up gets
// deleted with this list's last entry. Names not on this list are still
// guarded.
const CARRIED_FOR_V3 = new Set([
  "attachment",
  "badge",
  "breadcrumb",
  "bubble",
  "checkbox",
  "collapsible",
  "command",
  "confirm-dialog",
  "dropdown-menu",
  "message",
  "message-scroller",
  "native-select",
  "popover",
  "sidebar",
  "sonner",
  "spinner",
  "switch",
]);

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
  it("every src/components file has at least one consumer", () => {
    const components = fs
      .readdirSync(COMPONENTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
      .map((entry) => entry.name.replace(/\.tsx$/, ""))
      .filter((name) => !CARRIED_FOR_V3.has(name));

    // The WHOLE repo, not a list of workspace groups. This carried
    // `["apps", "packages"]` and had already fallen behind `tools/` and `e2e`,
    // which is the shape of the bug rather than a typo: a consumer living in a
    // group nobody remembered to add reads as absent, and this guard's answer
    // to absent is "delete the component".
    const files: string[] = [];
    sourceFiles(REPO_ROOT, files);

    const contents = new Map(files.map((file) => [file, fs.readFileSync(file, "utf8")]));
    const orphans = components.filter((name) => {
      for (const [file, content] of contents) {
        const isSelf = file === path.join(COMPONENTS_DIR, `${name}.tsx`);
        if (isSelf) continue;
        // Cross-workspace: `@repo/ui/components/<name>`.
        if (content.includes(`@repo/ui/components/${name}"`)) return false;
        // Intra-package: a sibling component or a hook importing `./<name>`.
        const intraPackage = file.startsWith(path.join(PACKAGE_ROOT, "src") + path.sep);
        if (intraPackage && new RegExp(`from "\\.{1,2}(/components)?/${name}"`).test(content)) {
          return false;
        }
      }
      return true;
    });

    expect(
      orphans,
      `Unused @repo/ui components (no importer anywhere in the repo).\n` +
        `Delete them — shadcn re-adds any of these in one command — or wire them up:\n` +
        orphans.map((name) => `  packages/ui/src/components/${name}.tsx`).join("\n"),
    ).toEqual([]);
  });
});
