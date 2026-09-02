// A kit that eagerly imports back into the shell seams closes a cycle around the
// kits, and a kit export then evaluates to undefined at module-init time; oxlint
// and knip do not detect cycles. Only eager edges count: type-only imports are
// erased and dynamic import() is the escape hatch.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const EDITOR = path.resolve(import.meta.dirname, "..");

// both roots: EDITOR_KIT pulls in the reach-back surface (host, comment store, slash menu) base-kit never sees
const ENTRIES = ["kits/base-kit.ts", "kits/editor-kit.ts"] as const;

function resolve(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@repo/editor/")) {
    base = path.join(EDITOR, specifier.slice("@repo/editor/".length));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
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

// comments are stripped first so a specifier quoted in prose never counts as an edge
function eagerImports(file: string): string[] {
  const source = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const specifiers: string[] = [];
  const importRe = /import\s+(?:(type)\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(importRe)) {
    const typeKeyword = match[1];
    const clause = match[2] ?? "";
    const specifier = match[3];
    if (specifier === undefined) continue;
    if (typeKeyword !== undefined) continue;
    // erased only if every binding is a type
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
