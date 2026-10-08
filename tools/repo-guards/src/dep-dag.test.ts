// pinned from both sides: a manifest can declare an edge nobody imports, and an import can cross an
// edge no manifest declares (pnpm's hoisting resolves it). adding a package or an edge: add the
// row.

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  importsOf,
  isTestFile,
  manifestWorkspaceDeps,
  resolveWorkspace,
  workspaceFiles,
  workspaces,
} from "./repo";
import type { Workspace } from "./repo";

// what each workspace's shipped source may import; test-only imports are not edges but must still
// be declared in the manifest.
const DECLARED_EDGES = new Map<string, readonly string[]>(
  Object.entries({
    "@repo/contract": ["@repo/domain"],
    // below the wire: an edge to @repo/contract would drag @orpc/contract and the contract's zod
    // surface into a package that only writes rows.
    "@repo/db": ["@repo/domain"],
    // the page alone: the shell is Rust (src-tauri), and every rule it shares with the server it
    // asks the CLI's desktop entry for, so no source here imports `inteligir`. its suites boot a
    // server in-process, which is a test dependency, not a shipped edge.
    "@repo/desktop": ["@repo/contract", "@repo/domain", "@repo/ui"],
    "@repo/domain": [],
    // the `inteligir` edge is the binary it spawns and the config resolution naming this checkout's
    // instance.
    "@repo/e2e": ["@repo/contract", "inteligir"],
    // a partial cloud client: reads the thread log and asks a Mac through the dispatch inbox, never
    // pushes or claims; it reaches no server or agent.
    "@repo/mobile": ["@repo/contract", "@repo/domain"],
    "@repo/repo-guards": [],
    "@repo/ui": [],
    "@repo/web": ["@repo/contract", "@repo/ui"],
    // the server reaches no page: no @repo/ui, no react.
    inteligir: ["@repo/contract", "@repo/db", "@repo/domain"],
  }),
);

// installed and executed, never imported: absent from DECLARED_EDGES on purpose, so a module import
// across one still fails as undeclared. its own table because the manifest checks read opposite
// things off one row: pnpm must link it, and nothing under src/ imports it.
const DECLARED_ARTIFACT_EDGES = new Map<string, Record<string, string>>();

const artifactEdgesFrom = (name: string): Record<string, string> =>
  DECLARED_ARTIFACT_EDGES.get(name) ?? {};

const platformSurfacesOf = (specifier: string): string[] => {
  const surfaces: string[] = [];
  if (specifier.startsWith("node:")) {
    surfaces.push("node");
  }
  if (specifier === "react" || specifier.startsWith("react/")) {
    surfaces.push("react");
  }
  if (specifier === "react-dom" || specifier.startsWith("react-dom/")) {
    surfaces.push("react");
  }
  // the desktop shell's own API: only the desktop page, which runs inside the shell, may reach it
  if (specifier.startsWith("@tauri-apps/")) {
    surfaces.push("tauri");
  }
  return surfaces;
};

interface PurityRule {
  forbidden: readonly string[];
  why: string;
}

// absent means no platform constraint.
const PURITY_RULES = new Map<string, PurityRule>(
  Object.entries({
    "@repo/contract": {
      forbidden: ["node", "react", "tauri"],
      why: "the contract both ends compile against: it loads in the desktop page, on node, on workerd and in React Native, so a platform import there is a package that stops loading somewhere",
    },
    "@repo/domain": {
      forbidden: ["node", "react", "tauri"],
      why: "a zod-only leaf: the thread grammar is parsed on both sides of every wire",
    },
    "@repo/ui": {
      forbidden: ["node", "tauri"],
      why: "browser-only, and consumed by the Worker's SSR half as well as the local app",
    },
  }),
);

// @repo/contract is not here: @orpc/contract is isomorphic and costs no portability.
const ZOD_ONLY_LEAVES = ["@repo/domain"];

// @repo/contract/cloud may never break and @repo/contract/local may break freely, so a workspace that ships
// apart from the desktop bundle reaches the cloud entry alone; each row says why it ships apart.
const CLOUD_ONLY_CLIENTS = new Map<string, string>([
  ["@repo/web", "it serves the cloud wire and only the cloud wire"],
  [
    "@repo/mobile",
    "a phone install may be months stale against the deployed Worker, while /local ships in the desktop bundle and may break freely",
  ],
]);

const edgesFrom = (workspace: Workspace, files: readonly string[]): Map<string, string[]> => {
  const edges = new Map<string, string[]>();
  for (const file of files) {
    for (const specifier of importsOf(file)) {
      const target = resolveWorkspace(specifier);
      if (target === null || target.name === workspace.name) {
        continue;
      }
      const sites = edges.get(target.name) ?? [];
      if (!sites.includes(file)) {
        sites.push(file);
      }
      edges.set(target.name, sites);
    }
  }
  return edges;
};

const shippedEdges = new Map<string, Map<string, string[]>>();
const testEdges = new Map<string, Map<string, string[]>>();
for (const workspace of workspaces()) {
  const files = workspaceFiles(workspace);
  shippedEdges.set(workspace.name, edgesFrom(workspace, files.shipped));
  testEdges.set(workspace.name, edgesFrom(workspace, files.test));
}

const declaredFor = (name: string): readonly string[] => {
  const row = DECLARED_EDGES.get(name);
  if (row === undefined) {
    throw new Error(
      `${name} has no row in DECLARED_EDGES (tools/repo-guards/src/dep-dag.test.ts).\n` +
        `A new workspace joins the DAG by declaring which packages it may import.`,
    );
  }
  return row;
};

describe("the package dependency DAG", () => {
  it("every workspace has a row in the declared table", () => {
    for (const workspace of workspaces()) {
      declaredFor(workspace.name);
    }
  });

  it("the shipped import graph matches the declared table", () => {
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      const declared = new Set(declaredFor(workspace.name));
      const actual = shippedEdges.get(workspace.name) ?? new Map<string, string[]>();
      for (const [target, sites] of actual) {
        if (declared.has(target)) {
          continue;
        }
        violations.push(
          `UNDECLARED EDGE  ${workspace.name} -> ${target}\n` +
            `  rule: an edge between workspaces is declared in DECLARED_EDGES before it is imported\n${sites
              .map((site) => `  at ${site}`)
              .join("\n")}`,
        );
      }
      for (const target of declared) {
        if (actual.has(target)) {
          continue;
        }
        violations.push(
          `DEAD EDGE  ${workspace.name} -> ${target}\n` +
            `  rule: DECLARED_EDGES states what shipped source ACTUALLY imports; nothing under ${workspace.dir}/src imports it\n` +
            `  fix: delete the row entry (and the manifest dependency, if the tests do not need it either)`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every imported workspace is declared in the importer's manifest", () => {
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      const declared = manifestWorkspaceDeps(workspace.manifest);
      for (const bucket of [shippedEdges, testEdges]) {
        for (const [target, sites] of bucket.get(workspace.name) ?? []) {
          if (declared.has(target)) {
            continue;
          }
          violations.push(
            `UNDECLARED DEPENDENCY  ${workspace.dir}/package.json is missing "${target}"\n` +
              `  rule: an import that pnpm's hoisting happens to resolve is not a declared dependency\n${sites
                .map((site) => `  at ${site}`)
                .join("\n")}`,
          );
        }
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every workspace dependency a manifest declares is imported somewhere", () => {
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      const used = new Set([
        ...(shippedEdges.get(workspace.name) ?? new Map<string, string[]>()).keys(),
        ...(testEdges.get(workspace.name) ?? new Map<string, string[]>()).keys(),
      ]);
      const artifact = artifactEdgesFrom(workspace.name);
      for (const target of manifestWorkspaceDeps(workspace.manifest)) {
        if (used.has(target) || artifact[target] !== undefined) {
          continue;
        }
        violations.push(
          `PHANTOM DEPENDENCY  ${workspace.dir}/package.json declares "${target}"\n` +
            `  rule: a declared dependency has an importer; nothing under ${workspace.dir}/src imports this one\n` +
            `  fix: delete it — or, if ${workspace.name} INSTALLS AND EXECUTES ${target}'s build output instead of importing it, add a row to DECLARED_ARTIFACT_EDGES (tools/repo-guards/src/dep-dag.test.ts) saying so`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every declared artifact edge is a real, unimported manifest dependency", () => {
    const violations: string[] = [];
    for (const [name, targets] of DECLARED_ARTIFACT_EDGES) {
      const workspace = workspaces().find((candidate) => candidate.name === name);
      if (workspace === undefined) {
        violations.push(
          `STALE ARTIFACT EDGE  ${name} is not a workspace\n` +
            `  rule: an artifact edge names a package that exists, or it only ever excuses something nobody can find\n` +
            `  fix: delete the entry from DECLARED_ARTIFACT_EDGES`,
        );
        continue;
      }
      const declared = manifestWorkspaceDeps(workspace.manifest);
      const imported = new Set([
        ...(shippedEdges.get(name) ?? new Map<string, string[]>()).keys(),
        ...(testEdges.get(name) ?? new Map<string, string[]>()).keys(),
      ]);
      for (const [target, why] of Object.entries(targets)) {
        if (!declared.has(target)) {
          violations.push(
            `STALE ARTIFACT EDGE  ${workspace.dir}/package.json no longer declares "${target}"\n` +
              `  the row claimed: ${why}\n` +
              `  fix: delete the row — an exemption that outlives its dependency only ever loosens the phantom check`,
          );
        }
        if (declaredFor(name).includes(target)) {
          violations.push(
            `EDGE DECLARED TWICE  ${name} -> ${target}\n` +
              `  rule: an artifact edge is INSTALLED AND EXECUTED, an entry in DECLARED_EDGES is IMPORTED — one dependency is one or the other, and a row in both tables makes the import check unenforceable\n` +
              `  fix: keep the row in whichever table describes what ${name} actually does with ${target}`,
          );
        }
        if (imported.has(target)) {
          violations.push(
            `ARTIFACT EDGE IS IMPORTED  ${name} -> ${target}\n` +
              `  the row claimed: ${why}\n` +
              `  rule: an artifact edge means "installed and executed", never "imported" — source under ${workspace.dir}/src imports it, so it is an ordinary edge\n` +
              `  fix: move it to DECLARED_EDGES, or stop importing it`,
          );
        }
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("has no cycles", () => {
    const state = new Map<string, "visiting" | "done">();
    const cycles: string[] = [];

    const visit = (name: string, stack: string[]): void => {
      if (state.get(name) === "done") {
        return;
      }
      if (state.get(name) === "visiting") {
        const from = stack.indexOf(name);
        cycles.push(
          `CYCLE  ${[...stack.slice(from), name].join(" -> ")}\n` +
            `  rule: the workspace graph is a DAG — a cycle makes build order, typecheck order and every "is a leaf" claim meaningless`,
        );
        return;
      }
      state.set(name, "visiting");
      for (const target of shippedEdges.get(name)?.keys() ?? []) {
        visit(target, [...stack, name]);
      }
      state.set(name, "done");
    };

    for (const workspace of workspaces()) {
      visit(workspace.name, []);
    }
    expect(cycles, `\n${cycles.join("\n\n")}\n`).toEqual([]);
  });
});

describe("platform purity", () => {
  it("no package reaches a platform its rule forbids", () => {
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      const rule = PURITY_RULES.get(workspace.name);
      if (rule === undefined) {
        continue;
      }
      for (const file of workspaceFiles(workspace).shipped) {
        for (const specifier of importsOf(file)) {
          for (const surface of platformSurfacesOf(specifier)) {
            if (!rule.forbidden.includes(surface)) {
              continue;
            }
            violations.push(
              `FORBIDDEN IMPORT  ${file} imports "${specifier}"\n` +
                `  rule: ${workspace.name} may not reach ${surface} — ${rule.why}`,
            );
          }
        }
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("the zod-only leaves declare only zod", () => {
    const violations: string[] = [];
    for (const name of ZOD_ONLY_LEAVES) {
      const workspace = workspaces().find((candidate) => candidate.name === name);
      if (workspace === undefined) {
        throw new Error(`${name} is not a workspace`);
      }
      const runtime = Object.keys(workspace.manifest.dependencies ?? {});
      const extra = runtime.filter((dep) => dep !== "zod");
      if (extra.length > 0) {
        violations.push(
          `NON-ZOD DEPENDENCY  ${workspace.dir}/package.json declares ${extra.join(", ")}\n` +
            `  rule: ${name} is a zod-only leaf — its grammar is parsed by every consumer on every target, so a second runtime dep ships everywhere`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("no package imports an app", () => {
    const appNames = new Set(
      workspaces()
        .filter((workspace) => workspace.dir.startsWith("apps/"))
        .map((workspace) => workspace.name),
    );
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      if (!workspace.dir.startsWith("packages/")) {
        continue;
      }
      const files = workspaceFiles(workspace);
      for (const file of [...files.shipped, ...files.test]) {
        for (const specifier of importsOf(file)) {
          const target = resolveWorkspace(specifier);
          if (target === null || !appNames.has(target.name)) {
            continue;
          }
          violations.push(
            `PACKAGE IMPORTS AN APP  ${file} imports "${specifier}"\n` +
              `  rule: packages are consumed BY apps — the arrow only points one way, or the library is an app in disguise`,
          );
        }
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every cloud-only client reaches @repo/contract's cloud entry and nothing else", () => {
    const violations: string[] = [];
    for (const [name, why] of CLOUD_ONLY_CLIENTS) {
      const client = workspaces().find((candidate) => candidate.name === name);
      if (client === undefined) {
        violations.push(
          `CLOUD_ONLY_CLIENTS ROW NAMES NO WORKSPACE  ${name}\n` +
            `  rule: a pin on a workspace that is gone pins nothing — delete the row from tools/repo-guards/src/dep-dag.test.ts`,
        );
        continue;
      }
      const files = workspaceFiles(client);
      for (const file of [...files.shipped, ...files.test]) {
        for (const specifier of importsOf(file)) {
          if (!specifier.startsWith("@repo/contract/")) {
            continue;
          }
          if (specifier.startsWith("@repo/contract/cloud/")) {
            continue;
          }
          violations.push(
            `LOCAL CONTRACT IN A CLOUD-ONLY CLIENT  ${file} imports "${specifier}"\n` +
              `  rule: ${name} reaches @repo/contract/cloud/* alone — ${why}`,
          );
        }
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("@repo/contract's cloud entry never reaches into its local entry", () => {
    // a file under src/cloud reaching src/local by relative path is invisible to the cloud-only
    // pin above; the sanctioned crossing is the other direction (local reusing a cloud constant).
    const contract = workspaces().find((candidate) => candidate.name === "@repo/contract");
    if (contract === undefined) {
      throw new Error("@repo/contract is not a workspace");
    }
    const cloudDir = path.join(contract.dir, "src", "cloud");
    const localDir = path.join(contract.dir, "src", "local");
    const files = workspaceFiles(contract);
    const violations: string[] = [];
    for (const file of [...files.shipped, ...files.test]) {
      if (!file.startsWith(`${cloudDir}/`) && !file.startsWith(`${localDir}/`)) {
        violations.push(
          `THIRD BUCKET  ${file}\n` +
            `  rule: every file under packages/contract/src lives in src/cloud or src/local — a third bucket is a file this guard never reads`,
        );
        continue;
      }
      if (!file.startsWith(`${cloudDir}/`)) {
        continue;
      }
      for (const specifier of importsOf(file)) {
        const reachesLocal = specifier.startsWith(".")
          ? path.join(path.dirname(file), specifier).startsWith(`${localDir}/`)
          : specifier === "@repo/contract/local" || specifier.startsWith("@repo/contract/local/");
        if (reachesLocal) {
          violations.push(
            `CLOUD REACHES LOCAL  ${file} imports "${specifier}"\n` +
              `  rule: @repo/contract/cloud is the never-break wire — it may import zod, @repo/domain and its own cloud/ modules, never src/local`,
          );
        }
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("the Cloudflare Worker imports no Node package", () => {
    // nodejs_compat shims some node: modules on workerd, not the native addons and spawned
    // processes behind them.
    const reachesNode = new Map<string, boolean>();
    const resolve = (name: string, seen: Set<string>): boolean => {
      const cached = reachesNode.get(name);
      if (cached !== undefined) {
        return cached;
      }
      if (seen.has(name)) {
        return false;
      }
      seen.add(name);
      const workspace = workspaces().find((candidate) => candidate.name === name);
      if (workspace === undefined) {
        return false;
      }
      const direct = workspaceFiles(workspace).shipped.some((file) =>
        importsOf(file).some((specifier) => specifier.startsWith("node:")),
      );
      const viaEdge = [...(shippedEdges.get(name)?.keys() ?? [])].some((target) =>
        resolve(target, seen),
      );
      const result = direct || viaEdge;
      reachesNode.set(name, result);
      return result;
    };

    const violations: string[] = [];
    const worker = workspaces().find((candidate) => candidate.name === "@repo/web");
    if (worker === undefined) {
      throw new Error("@repo/web is not a workspace");
    }
    for (const [target, sites] of shippedEdges.get(worker.name) ?? []) {
      if (!resolve(target, new Set())) {
        continue;
      }
      violations.push(
        `NODE PACKAGE IN THE WORKER  @repo/web -> ${target}\n` +
          `  rule: ${target}'s shipped source reaches node: — workerd has no native addons and no child processes, so this builds and then throws at runtime\n${sites
            .map((site) => `  at ${site}`)
            .join("\n")}`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});

describe("tests are excluded from the shipped graph", () => {
  it("classifies suites, fixtures and test-only ports as tests", () => {
    expect(isTestFile("packages/db/src/__tests__/db.test.ts")).toBe(true);
    expect(isTestFile("apps/cli/src/server/__tests__/boot-app.ts")).toBe(true);
    expect(isTestFile("packages/contract/src/cloud/test-support/fake-cloud-client.ts")).toBe(true);
    expect(isTestFile("packages/db/src/schema.ts")).toBe(false);
  });
});
