// A third-party dependency named by two or more workspace manifests must be
// spelled `catalog:` — two inline ranges for one package are two versions that
// can disagree, and the disagreement ships (the jsdom 29/30 split lived for a
// month before anything noticed). One manifest naming a package inline is
// fine: there is nothing to agree with, and hoisting every singleton would
// turn the catalog into a mirror of the lockfile.

import { describe, expect, it } from "vitest";

import { workspaces } from "./repo";

/** A deliberate version split: the workspace holds its own inline range while
 *  siblings ride the catalog. Every entry is a decision with its reason — an
 *  empty set is the healthy state. */
const DECLARED_SPLITS = new Set<string>([]);

/** workspace:* is first-party wiring and catalog: is already the answer. */
function isExemptSpec(spec: string): boolean {
  return spec.startsWith("workspace:") || spec.startsWith("catalog:");
}

describe("catalog spelling", () => {
  it("a dependency in two or more manifests is spelled catalog:", () => {
    const inlineBy = new Map<string, { workspace: string; spec: string }[]>();
    const namedBy = new Map<string, Set<string>>();
    for (const workspace of workspaces()) {
      const groups = [workspace.manifest.dependencies, workspace.manifest.devDependencies];
      for (const group of groups) {
        for (const [name, spec] of Object.entries(group ?? {})) {
          if (spec.startsWith("workspace:")) continue;
          const holders = namedBy.get(name) ?? new Set<string>();
          holders.add(workspace.name);
          namedBy.set(name, holders);
          if (isExemptSpec(spec)) continue;
          const rows = inlineBy.get(name) ?? [];
          rows.push({ workspace: workspace.name, spec });
          inlineBy.set(name, rows);
        }
      }
    }

    const violations: string[] = [];
    for (const [name, rows] of [...inlineBy.entries()].toSorted((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const holderCount = namedBy.get(name)?.size ?? 0;
      if (holderCount < 2) continue;
      if (DECLARED_SPLITS.has(name)) continue;
      violations.push(
        `${name} — named by ${String(holderCount)} workspaces, spelled inline in ` +
          rows.map((row) => `${row.workspace} (${row.spec})`).join(", "),
      );
    }

    expect(
      violations,
      violations.length === 0
        ? ""
        : `MULTI-MANIFEST DEPENDENCIES SPELLED INLINE\n` +
            violations.map((line) => `  ${line}`).join("\n") +
            `\n  rule: a package two workspaces name is one version the repo has to agree on — move the range to pnpm-workspace.yaml's catalog and spell every manifest "catalog:"\n` +
            `  (a deliberate version split is a DECLARED_SPLITS row in this file, with its reason)`,
    ).toEqual([]);
  });
});
