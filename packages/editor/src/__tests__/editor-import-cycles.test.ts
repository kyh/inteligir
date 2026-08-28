// Machine-enforce the editor-kit import acyclicity that the kit files also
// assert in prose.
//
// The kit roots compose the Plate kit files, so a kit that EAGERLY imports
// back into the shell seams (the editor host, the open-note store,
// transclusion) closes a cycle around the kits. The failure mode is vicious:
// a kit export evaluates to `undefined` at module-init time, so the editor
// breaks intermittently, far from the import that caused it. The comments in
// `transclusion.tsx`, `wiki-chip.tsx`, `block-list.tsx`, `wiki-link-kit.tsx`
// and `wiki-input-key.ts` state the rule but cannot enforce it — oxlint and
// knip do not detect cycles, so this test is the only thing in CI that does.
//
// The rule the code actually relies on is that those reach-backs are LAZY
// (`React.lazy(() => import(...))`), which breaks the cycle at runtime. So this
// walks only EAGER edges:
//   - `import type` / `import { type X }` are erased by the compiler and cannot
//     create a runtime cycle — excluded, or every type reference is a false
//     positive.
//   - dynamic `import(...)` is the deliberate escape hatch — excluded.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const EDITOR = path.resolve(import.meta.dirname, "..");

/**
 * BOTH kit roots, because they are not the same graph. `base-kit.ts` composes
 * the shared nodes; `EDITOR_KIT` is what the SHIPPED editor runs, and the kits
 * only it pulls in (the host, the comment store, the slash menu, the find bar,
 * the autocompletes) are exactly the reach-back surface this guard exists for.
 * Walking base-kit alone leaves that half unwatched.
 */
const ENTRIES = ["kits/base-kit.ts", "kits/editor-kit.ts"] as const;

/** Resolve a specifier to a file inside @repo/editor, or null if it leaves. */
function resolve(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@repo/editor/")) {
    base = path.join(EDITOR, specifier.slice("@repo/editor/".length));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null; // node_modules / other workspaces — cannot close a local cycle
  }
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Eager (value) import specifiers of a module. Strips comments first so a
 * specifier quoted in prose never counts as an edge. */
function eagerImports(file: string): string[] {
  const source = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const specifiers: string[] = [];
  // `import ... from "x"` and bare `import "x"`. The `from` clause is captured
  // so the type-only check can inspect what precedes it.
  const importRe = /import\s+(?:(type)\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(importRe)) {
    const typeKeyword = match[1];
    const clause = match[2] ?? "";
    const specifier = match[3];
    if (specifier === undefined) continue;
    // `import type X from` — fully erased.
    if (typeKeyword !== undefined) continue;
    // `import { type A, type B } from` — erased only if EVERY binding is a
    // type; a single value binding keeps the module edge.
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named?.[1] !== undefined) {
      const bindings = named[1]
        .split(",")
        .map((binding) => binding.trim())
        .filter(Boolean);
      if (bindings.length > 0 && bindings.every((binding) => binding.startsWith("type "))) continue;
    }
    specifiers.push(specifier);
  }
  for (const match of source.matchAll(/import\s+["']([^"']+)["']/g)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Depth-first search from `entry` over eager edges, returning the first cycle
 * as a path of repo-relative files. */
function findCycle(entry: string): string[] | null {
  const onStack = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];

  function visit(file: string): string[] | null {
    if (onStack.has(file)) return [...stack.slice(stack.indexOf(file)), file];
    if (done.has(file)) return null;
    onStack.add(file);
    stack.push(file);
    for (const specifier of eagerImports(file)) {
      const target = resolve(specifier, file);
      if (target === null) continue;
      const cycle = visit(target);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    onStack.delete(file);
    done.add(file);
    return null;
  }

  return visit(entry);
}

describe("editor kit import graph", () => {
  it.each(ENTRIES)("has no eager import cycle rooted at %s", (relative) => {
    const entry = path.join(EDITOR, relative);
    expect(fs.existsSync(entry), `${relative} moved — update this guard`).toBe(true);

    const cycle = findCycle(entry);
    const rendered =
      cycle === null ? "" : cycle.map((file) => `  ${path.relative(EDITOR, file)}`).join("\n  ↓\n");

    expect(
      cycle,
      `Eager import cycle around the Plate kits, rooted at ${relative}. A kit\n` +
        `export will evaluate to undefined at module-init time and break the\n` +
        `editor intermittently. Break it with React.lazy(() => import(...)) at\n` +
        `the workspace boundary:\n\n${rendered}\n`,
    ).toBeNull();
  });

  it.each(ENTRIES)("still walks a meaningful graph from %s (no-op resolver guard)", (relative) => {
    // If resolution silently stopped working, the cycle check above would pass
    // vacuously. Assert the entry really does reach a good chunk of the editor.
    const seen = new Set<string>();
    const queue = [path.join(EDITOR, relative)];
    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      for (const specifier of eagerImports(file)) {
        const target = resolve(specifier, file);
        if (target !== null) queue.push(target);
      }
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});
