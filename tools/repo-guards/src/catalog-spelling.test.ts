// a package one manifest names inline is fine: hoisting every singleton would make the catalog a
// mirror of the lockfile.

import { describe, expect, it } from "vitest";

import { workspaces } from "./repo";

// a deliberate version split, keyed by package name, with its reason; empty is the healthy state.
const DECLARED_SPLITS = new Map<string, string>();

const isExemptSpec = (spec: string): boolean =>
  spec.startsWith("workspace:") || spec.startsWith("catalog:");

interface InlineSpec {
  workspace: string;
  spec: string;
}

interface Spellings {
  // package → every inline (non-catalog) spec a manifest writes for it.
  inlineBy: Map<string, InlineSpec[]>;
  // package → the workspaces whose manifests name it at all.
  namedBy: Map<string, Set<string>>;
}

const manifestSpellings = (): Spellings => {
  const spellings: Spellings = { inlineBy: new Map(), namedBy: new Map() };
  for (const workspace of workspaces()) {
    const groups = [workspace.manifest.dependencies, workspace.manifest.devDependencies];
    for (const group of groups) {
      for (const [name, spec] of Object.entries(group ?? {})) {
        if (spec.startsWith("workspace:")) {
          continue;
        }
        const holders = spellings.namedBy.get(name) ?? new Set<string>();
        holders.add(workspace.name);
        spellings.namedBy.set(name, holders);
        if (isExemptSpec(spec)) {
          continue;
        }
        const rows = spellings.inlineBy.get(name) ?? [];
        rows.push({ spec, workspace: workspace.name });
        spellings.inlineBy.set(name, rows);
      }
    }
  }
  return spellings;
};

describe("catalog spelling", () => {
  it("a dependency in two or more manifests is spelled catalog:", () => {
    const { inlineBy, namedBy } = manifestSpellings();
    const violations: string[] = [];
    for (const [name, rows] of [...inlineBy.entries()].toSorted((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const holderCount = namedBy.get(name)?.size ?? 0;
      if (holderCount < 2) {
        continue;
      }
      if (DECLARED_SPLITS.has(name)) {
        continue;
      }
      violations.push(
        `${name} — named by ${String(holderCount)} workspaces, spelled inline in ${rows
          .map((row) => `${row.workspace} (${row.spec})`)
          .join(", ")}`,
      );
    }

    expect(
      violations,
      violations.length === 0
        ? ""
        : `MULTI-MANIFEST DEPENDENCIES SPELLED INLINE\n${violations
            .map((line) => `  ${line}`)
            .join(
              "\n",
            )}\n  rule: a package two workspaces name is one version the repo has to agree on — move the range to pnpm-workspace.yaml's catalog and spell every manifest "catalog:"\n` +
            `  (a deliberate version split is a DECLARED_SPLITS row in this file, with its reason)`,
    ).toEqual([]);
  });

  it("no DECLARED_SPLITS row outlives its split", () => {
    const { inlineBy, namedBy } = manifestSpellings();
    const stale = [...DECLARED_SPLITS.keys()].filter(
      (name) => (namedBy.get(name)?.size ?? 0) < 2 || (inlineBy.get(name)?.length ?? 0) === 0,
    );
    expect(
      stale,
      `DECLARED_SPLITS rows that excuse nothing — the package is named by fewer than two manifests, or no manifest spells it inline any more:\n` +
        `${stale.map((name) => `  ${name}`).join("\n")}\n` +
        `  fix: delete the row from tools/repo-guards/src/catalog-spelling.test.ts`,
    ).toEqual([]);
  });
});
