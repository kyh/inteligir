// ---------------------------------------------------------------------------
// Gallery coverage: every @repo/ui component has a demo.
//
// The sibling invariant to packages/ui's orphan guard, and the reason the
// gallery cannot be a runtime `import.meta.glob`: a glob would render every
// component with no props and call that coverage, when what a reader needs is
// the component's PURPOSE and its meaningful states — which only a hand-written
// demo carries. So the demos are authored, and this asserts none was forgotten.
//
// Derived from the package's own directories, so a component added tomorrow
// fails here until someone writes its demo.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GALLERY_DIR = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(GALLERY_DIR, "../../../../../..");
const UI_SRC = path.join(REPO_ROOT, "packages", "ui", "src");

/** The swept roots and the import subpath each publishes. Mirrors the orphan
 *  guard's own ROOTS table — the two tests ask opposite questions about the
 *  same set. */
const ROOTS = [
  { dir: "components", subpath: "components" },
  { dir: "ai", subpath: "ai" },
] as const;

/**
 * Components with no honest demo, each with the reason. A file here is a
 * decision, not a backlog: anything that CAN be demoed should be.
 */
const NOT_DEMOED = new Map<string, string>([
  [
    "components/sidebar-core",
    "Internal to sidebar.tsx — its parts are demoed through the Sidebar composition.",
  ],
  [
    "components/sidebar-menu",
    "Internal to sidebar.tsx — its parts are demoed through the Sidebar composition.",
  ],
]);

function componentNames(dir: string): string[] {
  const root = path.join(UI_SRC, dir);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => entry.name.replace(/\.tsx$/, ""));
}

function gallerySource(): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(full);
      } else if (entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };
  walk(GALLERY_DIR);
  return files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
}

describe("gallery coverage", () => {
  it("every @repo/ui component is demoed, or says why not", () => {
    const source = gallerySource();
    const missing: string[] = [];

    for (const root of ROOTS) {
      for (const name of componentNames(root.dir)) {
        const key = `${root.dir}/${name}`;
        if (NOT_DEMOED.has(key)) continue;
        if (source.includes(`@repo/ui/${root.subpath}/${name}"`)) continue;
        missing.push(`  packages/ui/src/${key}.tsx`);
      }
    }

    expect(
      missing,
      `Components with no gallery demo.\n` +
        `The gallery is the design system's reference — a component nobody demoed is a\n` +
        `component nobody can find. Add a Demo section for each, or record it in\n` +
        `NOT_DEMOED (apps/desktop/src/renderer/app/gallery/__tests__/gallery-coverage.test.ts) with\n` +
        `the reason it cannot be shown honestly:\n` +
        missing.join("\n"),
    ).toEqual([]);
  });

  it("every NOT_DEMOED entry still names a real component", () => {
    // A stale exemption is worse than none: it silently excuses a component
    // that was renamed or deleted, and the next one to take that name.
    const known = new Set(
      ROOTS.flatMap((root) => componentNames(root.dir).map((name) => `${root.dir}/${name}`)),
    );
    const stale = [...NOT_DEMOED.keys()].filter((key) => !known.has(key));

    expect(
      stale,
      `NOT_DEMOED names components that no longer exist — delete these rows:\n` +
        stale.map((key) => `  ${key}`).join("\n"),
    ).toEqual([]);
  });
});
