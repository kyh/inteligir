// ---------------------------------------------------------------------------
// Dep-DAG guard. CLAUDE.md's "Dep DAG (every edge…)" paragraph is the record
// agents read before deciding where code may live — and it is the one piece of
// prose in this repo that restates data the compiler already owns. A `pnpm add`
// inside a package cannot break it, so the paragraph silently becomes fiction
// and every later "which package may import which" decision is made against a
// stale map.
//
// So the paragraph is parsed, not trusted: each `x→a+b+c` clause and the
// "… are leaves" clause is checked against the real @repo/* edges in every
// packages/*/package.json, in BOTH directions. An undocumented dep fails; a
// documented edge that no longer exists fails; a new package that the paragraph
// never mentions fails. The prose stays hand-written (it carries WHY, which no
// generator can emit) — only its factual claims are pinned.
//
// The second case is what the packages under packages/ SHIP. They are bundled
// into a browser and into React Native, so a `node:` or `electron` import is a
// build-time failure at best and a runtime one at worst — but their tests walk
// the filesystem on purpose, and no lint rule can tell the two apart by
// package. This walks the shipped source only, which is exactly the hole a
// per-package lint override would leave open.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CLAUDE_MD = path.join(REPO_ROOT, "CLAUDE.md");

const SCOPE = "@repo/";

/** `editor→bridge+notes+ui` — the paragraph's edge notation. */
const EDGE_CLAUSE = /\b([a-z][a-z-]*)→([a-z][a-z-]*(?:\+[a-z][a-z-]*)*)/g;
/** `notes and ui are leaves` — the zero-edge packages. */
const LEAF_CLAUSE = /\b([a-z][a-z, -]*?) are leaves\b/;

/** A node built-in or electron module specifier in an import/require/dynamic
 * import. Prose mentions in comments are not imports and must not count. */
const HOST_IMPORT =
  /(?:^|[\s(])(?:import|require)[^\n]*?["'](node:[^"']+|electron(?:\/[^"']*)?)["']/m;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldKeys(field: unknown): string[] {
  return isRecord(field) ? Object.keys(field) : [];
}

interface Manifest {
  /** Package name with the `@repo/` scope stripped — the paragraph's notation. */
  readonly short: string;
  readonly workspaceDeps: ReadonlySet<string>;
}

/** Every dependency field counts: a devDependency is as real an edge as a
 * runtime one for "can this package import that one". */
function readManifest(file: string): Manifest | null {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(parsed) || typeof parsed.name !== "string") return null;
  const deps = [
    ...fieldKeys(parsed.dependencies),
    ...fieldKeys(parsed.devDependencies),
    ...fieldKeys(parsed.peerDependencies),
  ];
  return {
    short: parsed.name.startsWith(SCOPE) ? parsed.name.slice(SCOPE.length) : parsed.name,
    workspaceDeps: new Set(
      deps.filter((dep) => dep.startsWith(SCOPE)).map((dep) => dep.slice(SCOPE.length)),
    ),
  };
}

/** Derived from disk, so a new package is swept without extending a hand list. */
function manifests(group: string): Manifest[] {
  const groupDir = path.join(REPO_ROOT, group);
  const found: Manifest[] = [];
  for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(groupDir, entry.name, "package.json");
    if (!fs.existsSync(file)) continue;
    const manifest = readManifest(file);
    if (manifest !== null) found.push(manifest);
  }
  return found;
}

function dagParagraph(): string {
  const doc = fs.readFileSync(CLAUDE_MD, "utf8");
  const start = doc.indexOf("Dep DAG");
  expect(start, "CLAUDE.md no longer has a `Dep DAG` paragraph").toBeGreaterThan(-1);
  const end = doc.indexOf("\n\n", start);
  return doc.slice(start, end === -1 ? undefined : end);
}

function documentedEdges(paragraph: string): Map<string, ReadonlySet<string>> {
  const edges = new Map<string, ReadonlySet<string>>();

  const leaves = LEAF_CLAUSE.exec(paragraph);
  const leafList = leaves?.[1];
  if (leafList !== undefined) {
    for (const leaf of leafList.split(/,| and /).map((name) => name.trim())) {
      if (leaf.length > 0) edges.set(leaf, new Set());
    }
  }

  for (const match of paragraph.matchAll(EDGE_CLAUSE)) {
    const source = match[1];
    const targets = match[2];
    if (source === undefined || targets === undefined) continue;
    edges.set(source, new Set(targets.split("+")));
  }
  return edges;
}

/** Shipped source: everything under a package's `src`, minus its tests. */
function shippedFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") shippedFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
}

describe("dep DAG", () => {
  it("CLAUDE.md's Dep DAG paragraph matches the real package.json edges", () => {
    const paragraph = dagParagraph();
    const documented = documentedEdges(paragraph);
    const packages = manifests("packages");

    // Floors, so a notation change that stops the parse from matching anything
    // cannot make this vacuously green.
    expect(
      documented.size,
      "parsed no edges out of the Dep DAG paragraph — the notation changed",
    ).toBeGreaterThanOrEqual(4);
    expect(packages.length).toBeGreaterThanOrEqual(4);

    const problems: string[] = [];
    const real = new Set(packages.map((manifest) => manifest.short));

    for (const { short, workspaceDeps } of packages.toSorted((a, b) =>
      a.short.localeCompare(b.short),
    )) {
      const claimed = documented.get(short);
      if (claimed === undefined) {
        problems.push(`  ${short}: missing from the paragraph (list its edges, or as a leaf)`);
        continue;
      }
      const undocumented = [...workspaceDeps].filter((dep) => !claimed.has(dep)).toSorted();
      const phantom = [...claimed].filter((dep) => !workspaceDeps.has(dep)).toSorted();
      if (undocumented.length > 0) {
        problems.push(
          `  ${short}: depends on ${undocumented.join(", ")}, paragraph does not say so`,
        );
      }
      if (phantom.length > 0) {
        problems.push(`  ${short}: paragraph claims ${phantom.join(", ")}, package.json does not`);
      }
    }

    for (const short of [...documented.keys()].toSorted()) {
      if (!real.has(short)) {
        problems.push(`  ${short}: named in the paragraph, no such package under packages/`);
      }
    }

    expect(
      problems,
      `CLAUDE.md's Dep DAG paragraph disagrees with packages/*/package.json — fix\n` +
        `the dependency or the paragraph, whichever one is wrong:\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it("nothing packages/ ships imports node or electron", () => {
    const files: string[] = [];
    const packagesDir = path.join(REPO_ROOT, "packages");
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) shippedFiles(path.join(packagesDir, entry.name, "src"), files);
    }
    expect(files.length).toBeGreaterThan(50);

    const importers = files
      .filter((file) => HOST_IMPORT.test(fs.readFileSync(file, "utf8")))
      .map((file) => `  ${path.relative(REPO_ROOT, file).split(path.sep).join("/")}`);

    expect(
      importers,
      `packages/ is bundled into a browser and into React Native — shipped source ` +
        `cannot reach node or electron (tests may; they are excluded):\n${importers.join("\n")}`,
    ).toEqual([]);
  });
});
