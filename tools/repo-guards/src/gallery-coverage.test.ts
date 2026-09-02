// ---------------------------------------------------------------------------
// Gallery coverage: every @repo/ui component has a demo.
//
// The sibling invariant to the orphan-export guard — the two ask opposite
// questions about the same set — and the reason the gallery cannot be a
// runtime `import.meta.glob`: a glob would render every component with no
// props and call that coverage, when what a reader needs is the component's
// PURPOSE and its meaningful states, which only a hand-written demo carries.
// So the demos are authored, and this asserts none was forgotten.
//
// The roots are the exports map's own wildcard rows — the same set the orphan
// guard sweeps — each one either demoed or declared to hold no components,
// so a component added tomorrow fails here until someone writes its demo,
// and a new wildcard root fails until someone says which side it is on.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isTestFile, REPO_ROOT, sourceOf, workspaces, workspaceSourceFiles } from "./repo";
import { GALLERY_DIR, sweptRoots, UI_DIR, UI_PACKAGE } from "./ui-package";

/** The swept roots that hold no components, each with what they hold instead.
 *  A root missing from both this and the demoed set fails below. */
const NON_COMPONENT_ROOTS = new Map<string, string>([
  ["hooks", "Behaviour hooks and their providers — nothing to draw on its own."],
  ["lib", "Context providers and helpers the components read — nothing to draw on its own."],
]);

/** The roots every `.tsx` file of which is a component that owes a demo. */
function demoedRoots() {
  return sweptRoots().filter((root) => !NON_COMPONENT_ROOTS.has(root.dir));
}

/**
 * Components with no honest demo, each with the reason. A row here is a
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

const COMPONENT_FILE = /\.tsx$/;

function componentNames(dir: string): string[] {
  const root = path.join(REPO_ROOT, UI_DIR, "src", dir);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && COMPONENT_FILE.test(entry.name))
    .map((entry) => entry.name.replace(COMPONENT_FILE, ""));
}

/** Every shipped source file under the gallery, on repo.ts's own walk. */
function gallerySource(): string {
  const desktop = workspaces().find((workspace) => GALLERY_DIR.startsWith(`${workspace.dir}/`));
  if (desktop === undefined) {
    throw new Error(`${GALLERY_DIR} is inside no workspace`);
  }
  return workspaceSourceFiles(desktop)
    .filter((file) => file.startsWith(`${GALLERY_DIR}/`) && !isTestFile(file))
    .map((file) => sourceOf(file))
    .join("\n");
}

describe("gallery coverage", () => {
  it("every @repo/ui component is demoed, or says why not", () => {
    const source = gallerySource();
    const missing: string[] = [];

    for (const root of demoedRoots()) {
      for (const name of componentNames(root.dir)) {
        const key = `${root.dir}/${name}`;
        if (NOT_DEMOED.has(key)) continue;
        if (source.includes(`${UI_PACKAGE}/${root.subpath}/${name}"`)) continue;
        missing.push(`  ${UI_DIR}/src/${key}.tsx`);
      }
    }

    expect(
      missing,
      `Components with no gallery demo.\n` +
        `The gallery is the design system's reference — a component nobody demoed is a\n` +
        `component nobody can find. Add a Demo section under ${GALLERY_DIR} for each, or\n` +
        `record it in NOT_DEMOED (tools/repo-guards/src/gallery-coverage.test.ts) with\n` +
        `the reason it cannot be shown honestly:\n` +
        missing.join("\n"),
    ).toEqual([]);
  });

  it("every NOT_DEMOED entry still names a real component", () => {
    // A stale exemption is worse than none: it silently excuses a component
    // that was renamed or deleted, and the next one to take that name.
    const known = new Set(
      demoedRoots().flatMap((root) =>
        componentNames(root.dir).map((name) => `${root.dir}/${name}`),
      ),
    );
    const stale = [...NOT_DEMOED.keys()].filter((key) => !known.has(key));

    expect(
      stale,
      `NOT_DEMOED names components that no longer exist — delete these rows:\n` +
        stale.map((key) => `  ${key}`).join("\n"),
    ).toEqual([]);
  });

  it("every NON_COMPONENT_ROOTS entry is a root the exports map still publishes", () => {
    // The map drains: a row naming a directory the package stopped exporting
    // would otherwise excuse the next directory to take its name.
    const swept = new Set(sweptRoots().map((root) => root.dir));
    const stale = [...NON_COMPONENT_ROOTS.keys()].filter((dir) => !swept.has(dir));
    expect(
      stale,
      `NON_COMPONENT_ROOTS names roots @repo/ui no longer exports — delete these rows:\n` +
        stale.map((dir) => `  ${dir}`).join("\n"),
    ).toEqual([]);
  });

  it("the gallery it reads exists", () => {
    // A guard over an empty directory passes for every component at once —
    // the failure that matters is the silent one.
    expect(fs.existsSync(path.join(REPO_ROOT, GALLERY_DIR))).toBe(true);
  });
});
