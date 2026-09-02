// pinned from both sides: a manifest can declare an edge nobody imports, and an import can cross an
// edge no manifest declares (pnpm's hoisting resolves it). adding a package or an edge: add the
// row.

import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  importsOf,
  isTestFile,
  manifestWorkspaceDeps,
  resolveWorkspace,
  workspaceFiles,
  workspaces,
  type Workspace,
} from "./repo";

// what each workspace's shipped source may import; test-only imports are not edges but must still
// be declared in the manifest.
const DECLARED_EDGES = new Map<string, readonly string[]>(
  Object.entries({
    // leaves; agent-skills is content (markdown served to agents), imported as files.
    "@repo/agent-skills": [],
    "@repo/domain": [],
    "@repo/notes": [],
    "@repo/ui": [],

    // the editor draws with the shared component kit; @repo/ui stays a leaf below it.
    "@repo/editor": ["@repo/notes", "@repo/ui"],
    // the @repo/notes edge is the parser-free grammars the contract validates against (vault-path,
    // sidecar-schema); widening it to a remark-carrying module drags remark into every client
    // bundle.
    "@repo/api": ["@repo/domain", "@repo/notes"],
    "@repo/agent-runtime": ["@repo/domain"],
    // below the wire: an edge to @repo/api would drag hono and the contract's notes edge into a
    // package that only writes rows.
    "@repo/db": ["@repo/domain"],

    // the server reaches no page: no @repo/ui, no @repo/editor, no react.
    inteligir: ["@repo/agent-runtime", "@repo/api", "@repo/db", "@repo/domain", "@repo/notes"],
    // a partial cloud client: reads the thread log and produces captures, never pushes or claims.
    // the @repo/notes edge is the vault read surface (the dialect's own parse and link resolver);
    // it reaches no server, vault engine or agent.
    "@repo/mobile": ["@repo/api", "@repo/domain", "@repo/notes"],
    "@repo/web": ["@repo/api", "@repo/ui"],
    // `inteligir` for the facts both processes must agree on: config resolution, the token's file
    // and header spelling, the shutdown budget the stop grace must exceed, and the CSP the protocol
    // handler serves. forking its bundle as a child is the same dependency, declared once.
    "@repo/desktop": [
      "@repo/api",
      "@repo/domain",
      "@repo/editor",
      "@repo/notes",
      "@repo/ui",
      "inteligir",
    ],

    // the `inteligir` edge is the binary it spawns and the config resolution naming this checkout's
    // instance.
    "@repo/e2e": ["@repo/api", "inteligir"],
    "@repo/repo-guards": [],
  }),
);

// installed and executed, never imported: absent from DECLARED_EDGES on purpose, so a module import
// across one still fails as undeclared. its own table because the manifest checks read opposite
// things off one row: pnpm must link it, and nothing under src/ imports it.
const DECLARED_ARTIFACT_EDGES = new Map<string, Record<string, string>>(
  Object.entries({
    inteligir: {
      "@repo/agent-skills":
        "the dialect skills are CONTENT the agent reads with its shell — agent-shell-env.ts resolves the package's skills/ directory via createRequire and hands the path to agent sessions as INTELIGIR_SKILLS_DIR; no module import exists or should",
    },
  }),
);

function artifactEdgesFrom(name: string): Record<string, string> {
  return DECLARED_ARTIFACT_EDGES.get(name) ?? {};
}

function platformSurfacesOf(specifier: string): string[] {
  const surfaces: string[] = [];
  if (specifier.startsWith("node:")) surfaces.push("node");
  if (specifier === "react" || specifier.startsWith("react/")) surfaces.push("react");
  if (specifier === "react-dom" || specifier.startsWith("react-dom/")) surfaces.push("react");
  if (specifier === "electron" || specifier.startsWith("electron/")) surfaces.push("electron");
  return surfaces;
}

interface PurityRule {
  forbidden: readonly string[];
  why: string;
}

// absent means no platform constraint.
const PURITY_RULES = new Map<string, PurityRule>(
  Object.entries({
    "@repo/notes": {
      forbidden: ["node", "react", "electron"],
      why: "the pure sharing seam: it runs in the browser AND on node, and every platform capability (the SQL driver, the clock, content hashes) is INJECTED",
    },
    "@repo/domain": {
      forbidden: ["node", "react", "electron"],
      why: "a zod-only leaf: the thread grammar is parsed on both sides of every wire",
    },
    "@repo/api": {
      forbidden: ["node", "react", "electron"],
      why: "the contract both ends compile against: it loads in the Electron renderer, on node, on workerd and in React Native, so a platform import there is a package that stops loading somewhere",
    },
    "@repo/agent-runtime": {
      forbidden: ["react", "electron"],
      why: "it spawns provider processes, so it is node-side by definition — and nothing it exports may pull a process tree into a renderer; the grammars a client reads live in @repo/domain",
    },
    "@repo/editor": {
      forbidden: ["node", "electron"],
      why: "browser-only: Plate/Slate in the page, never in the Node process",
    },
    "@repo/ui": {
      forbidden: ["node", "electron"],
      why: "browser-only, and consumed by the Worker's SSR half as well as the local app",
    },
  }),
);

// @repo/api is not here: @orpc/contract is isomorphic and costs no portability.
const ZOD_ONLY_LEAVES = ["@repo/domain"];

function edgesFrom(workspace: Workspace, files: readonly string[]): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  for (const file of files) {
    for (const specifier of importsOf(file)) {
      const target = resolveWorkspace(specifier);
      if (target === null || target.name === workspace.name) continue;
      const sites = edges.get(target.name) ?? [];
      if (!sites.includes(file)) sites.push(file);
      edges.set(target.name, sites);
    }
  }
  return edges;
}

const shippedEdges = new Map<string, Map<string, string[]>>();
const testEdges = new Map<string, Map<string, string[]>>();
for (const workspace of workspaces()) {
  const files = workspaceFiles(workspace);
  shippedEdges.set(workspace.name, edgesFrom(workspace, files.shipped));
  testEdges.set(workspace.name, edgesFrom(workspace, files.test));
}

function declaredFor(name: string): readonly string[] {
  const row = DECLARED_EDGES.get(name);
  if (row === undefined) {
    throw new Error(
      `${name} has no row in DECLARED_EDGES (tools/repo-guards/src/dep-dag.test.ts).\n` +
        `A new workspace joins the DAG by declaring which packages it may import.`,
    );
  }
  return row;
}

describe("the package dependency DAG", () => {
  it("every workspace has a row in the declared table", () => {
    for (const workspace of workspaces()) declaredFor(workspace.name);
  });

  it("the shipped import graph matches the declared table", () => {
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      const declared = new Set(declaredFor(workspace.name));
      const actual = shippedEdges.get(workspace.name) ?? new Map<string, string[]>();
      for (const [target, sites] of actual) {
        if (declared.has(target)) continue;
        violations.push(
          `UNDECLARED EDGE  ${workspace.name} -> ${target}\n` +
            `  rule: an edge between workspaces is declared in DECLARED_EDGES before it is imported\n` +
            sites.map((site) => `  at ${site}`).join("\n"),
        );
      }
      for (const target of declared) {
        if (actual.has(target)) continue;
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
          if (declared.has(target)) continue;
          violations.push(
            `UNDECLARED DEPENDENCY  ${workspace.dir}/package.json is missing "${target}"\n` +
              `  rule: an import that pnpm's hoisting happens to resolve is not a declared dependency\n` +
              sites.map((site) => `  at ${site}`).join("\n"),
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
        if (used.has(target) || artifact[target] !== undefined) continue;
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
      if (state.get(name) === "done") return;
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

    for (const workspace of workspaces()) visit(workspace.name, []);
    expect(cycles, `\n${cycles.join("\n\n")}\n`).toEqual([]);
  });
});

describe("platform purity", () => {
  it("no package reaches a platform its rule forbids", () => {
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      const rule = PURITY_RULES.get(workspace.name);
      if (rule === undefined) continue;
      for (const file of workspaceFiles(workspace).shipped) {
        for (const specifier of importsOf(file)) {
          for (const surface of platformSurfacesOf(specifier)) {
            if (!rule.forbidden.includes(surface)) continue;
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
      if (workspace === undefined) throw new Error(`${name} is not a workspace`);
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
      if (!workspace.dir.startsWith("packages/")) continue;
      const files = workspaceFiles(workspace);
      for (const file of [...files.shipped, ...files.test]) {
        for (const specifier of importsOf(file)) {
          const target = resolveWorkspace(specifier);
          if (target === null || !appNames.has(target.name)) continue;
          violations.push(
            `PACKAGE IMPORTS AN APP  ${file} imports "${specifier}"\n` +
              `  rule: packages are consumed BY apps — the arrow only points one way, or the library is an app in disguise`,
          );
        }
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("the Cloudflare Worker reaches @repo/api's cloud entry and nothing else", () => {
    const worker = workspaces().find((candidate) => candidate.name === "@repo/web");
    if (worker === undefined) throw new Error("@repo/web is not a workspace");
    const files = workspaceFiles(worker);
    const violations: string[] = [];
    for (const file of [...files.shipped, ...files.test]) {
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith("@repo/api/")) continue;
        if (specifier.startsWith("@repo/api/cloud/")) continue;
        violations.push(
          `LOCAL CONTRACT IN THE WORKER  ${file} imports "${specifier}"\n` +
            `  rule: apps/web serves the cloud wire and only the cloud wire — @repo/api/cloud/* is its half of the package`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("@repo/api's cloud entry never reaches into its local entry", () => {
    // a file under src/cloud reaching src/local by relative path is invisible to the Worker pin
    // above; the sanctioned crossing is the other direction (local reusing a cloud constant).
    const api = workspaces().find((candidate) => candidate.name === "@repo/api");
    if (api === undefined) throw new Error("@repo/api is not a workspace");
    const cloudDir = join(api.dir, "src", "cloud");
    const localDir = join(api.dir, "src", "local");
    const files = workspaceFiles(api);
    const violations: string[] = [];
    for (const file of [...files.shipped, ...files.test]) {
      if (!file.startsWith(`${cloudDir}/`) && !file.startsWith(`${localDir}/`)) {
        violations.push(
          `THIRD BUCKET  ${file}\n` +
            `  rule: every file under packages/api/src lives in src/cloud or src/local — a third bucket is a file this guard never reads`,
        );
        continue;
      }
      if (!file.startsWith(`${cloudDir}/`)) continue;
      for (const specifier of importsOf(file)) {
        const reachesLocal = specifier.startsWith(".")
          ? join(dirname(file), specifier).startsWith(`${localDir}/`)
          : specifier === "@repo/api/local" || specifier.startsWith("@repo/api/local/");
        if (reachesLocal) {
          violations.push(
            `CLOUD REACHES LOCAL  ${file} imports "${specifier}"\n` +
              `  rule: @repo/api/cloud is the never-break wire — it may import zod, @repo/notes and its own cloud/ modules, never src/local`,
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
      if (cached !== undefined) return cached;
      if (seen.has(name)) return false;
      seen.add(name);
      const workspace = workspaces().find((candidate) => candidate.name === name);
      if (workspace === undefined) return false;
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
    if (worker === undefined) throw new Error("@repo/web is not a workspace");
    for (const [target, sites] of shippedEdges.get(worker.name) ?? []) {
      if (!resolve(target, new Set())) continue;
      violations.push(
        `NODE PACKAGE IN THE WORKER  @repo/web -> ${target}\n` +
          `  rule: ${target}'s shipped source reaches node: — workerd has no native addons and no child processes, so this builds and then throws at runtime\n` +
          sites.map((site) => `  at ${site}`).join("\n"),
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});

describe("tests are excluded from the shipped graph", () => {
  it("classifies suites, fixtures and test-only ports as tests", () => {
    expect(isTestFile("packages/db/src/__tests__/db.test.ts")).toBe(true);
    expect(isTestFile("apps/cli/src/server/__tests__/boot-app.ts")).toBe(true);
    expect(isTestFile("packages/agent-runtime/src/test-support/fake-acp-agent.mjs")).toBe(true);
    expect(isTestFile("packages/db/src/schema.ts")).toBe(false);
  });
});
