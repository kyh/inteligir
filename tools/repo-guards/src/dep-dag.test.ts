// ---------------------------------------------------------------------------
// The package dependency DAG, pinned from BOTH sides.
//
// A boundary between workspaces is only real if something fails when it moves,
// and the two things that can move are independent: a manifest can declare an
// edge nobody imports, and an import can cross an edge no manifest declares
// (pnpm's hoisting resolves it anyway, so nothing else notices). This walks the
// shipped source for the second and the manifests for the first, and holds both
// against ONE declared table.
//
// The platform rules below are the reason the DAG matters at all. `@repo/notes`
// is the sharing seam — it runs in a browser and on node, so a `node:` import
// there is not a style question, it is a package that stops loading. Only the
// `@repo/notes` rule is also lint-enforced (.oxlintrc.json); every other one
// lives here alone.
//
// Adding a package, or an edge between two: add the row. That is the whole
// point — the table is the review surface.
// ---------------------------------------------------------------------------

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

/**
 * THE table: which workspaces each workspace's SHIPPED source may import.
 * Test-only imports are not edges — a suite reaching for a fixture package says
 * nothing about what a consumer of this package pulls in — but they must still
 * be declared in the manifest, which the manifest test below covers.
 */
const DECLARED_EDGES = new Map<string, readonly string[]>(
  Object.entries({
    // Leaves. Nothing in this repo may be below them.
    // agent-skills is CONTENT (the vendored Moss dialect spec, issue #581) —
    // markdown served to agents, importing nothing and imported as files.
    "@repo/agent-skills": [],
    "@repo/cloud-contract": [],
    "@repo/domain": [],
    "@repo/notes": [],
    "@repo/typed-routes": [],
    "@repo/ui": [],

    // The Plate editor draws with the shared component kit — the same
    // shadcn-on-Base-UI vocabulary the app's chrome uses — so the edge is a
    // rendering dependency, not a domain one. @repo/ui stays a leaf below it.
    "@repo/editor": ["@repo/notes", "@repo/ui"],
    // The @repo/notes edge is two grammars the contract validates against —
    // the delegation anchor's token (`markdown/thread-anchor`) and the vault
    // path (`knowledge/vault-path`) — and it is narrow ON PURPOSE: both modules
    // are parser-free, so refusing a bad value in the contract cannot drag
    // remark into every client bundle. Widening this edge to a remark-carrying
    // module is the regression to catch.
    // The @repo/cloud-contract edge is ONE fact, and it is a wire fact: the
    // device name `/cloud/pair/begin` accepts is the name the cloud's own
    // `/v1/device/redeem` will eventually be sent, so the ceiling it validates
    // against has to be that route's. A hand-copied number here is a value this
    // end accepts and the cloud then refuses, arriving as a shape error long
    // after the click that caused it. Both packages are zod-only leaves, so the
    // edge costs a client bundle nothing but the schemas it already parses.
    "@repo/server-contract": [
      "@repo/cloud-contract",
      "@repo/domain",
      "@repo/notes",
      "@repo/typed-routes",
    ],
    "@repo/agent-runtime": ["@repo/domain"],
    // Persistence sits BELOW the wire: the store announces its writes through
    // @repo/domain's `DbNotifier`, whose change-kind vocabulary the contract
    // serializes. An edge the other way would drag hono, the route machinery and
    // the contract's own @repo/notes edge into the build graph of a package that
    // only writes rows.
    "@repo/db": ["@repo/domain"],
    "@repo/thread-view": ["@repo/domain", "@repo/server-contract"],

    // The product: the one workspace that composes everything.
    "@repo/app": [
      "@repo/agent-runtime",
      // The cloud wire (issue #572). This app is the OTHER end of what
      // apps/web serves: the sync client parses the same push/pull/capture
      // schemas, the same ws ping frames and the same error envelope the Worker
      // produces, so the contract has two implementations and no second reading.
      // It stays a zod-only leaf precisely so this edge costs the local process
      // nothing beyond the grammar.
      "@repo/cloud-contract",
      "@repo/db",
      "@repo/domain",
      "@repo/editor",
      "@repo/notes",
      "@repo/server-contract",
      "@repo/thread-view",
      "@repo/typed-routes",
      "@repo/ui",
    ],
    // The mobile companion (issue #576). It is the THIRD implementation of the
    // cloud wire — a sync-only thread/capture client that parses the same
    // push/pull/capture schemas and error envelope apps/web serves and apps/app
    // consumes, over React Native storage instead of better-sqlite3. The
    // @repo/domain edge is the ThreadEvent grammar: the pull answers opaque
    // event bodies, and this client parses each with `threadEventSchema` before
    // it renders one. Both are zod-only leaves, so the edge costs the RN bundle
    // only the schemas it already parses — and the phone reaches NOTHING else
    // in the repo (no apps/app Node, no apps/web worker, no @repo/notes vault
    // engine): the settled shape is that the agent and the vault stay on the
    // desktop.
    "@repo/mobile": ["@repo/cloud-contract", "@repo/domain"],
    // Drives a RUNNING app over the typed client; the @repo/app edge is the
    // discovery config (which port/dataDir this checkout means), not the server.
    // It reaches no runtime — an approval it prints is domain grammar, and a
    // client that could not print one without the package that spawns provider
    // processes would be carrying a process tree to format a string.
    "@repo/cli": ["@repo/app", "@repo/domain", "@repo/server-contract", "@repo/thread-view"],
    // The Cloudflare Worker. Only the two zod-only/browser-only packages it can
    // survive on workerd — see the workerd rule below for what enforces that
    // beyond this row.
    "@repo/web": ["@repo/cloud-contract", "@repo/ui"],
    // The two SHIPPING surfaces. Both consume the product as a BUILT DIRECTORY
    // rather than as a module — the launcher stages @repo/app's and @repo/cli's
    // dist into its own package and imports the staged bundle by path; the shell
    // spawns that bundle as a child. The build ORDER those relationships need
    // lives in each turbo.json as an explicit `<package>#build`, which is what
    // it is — an ordering, not an import edge.
    inteligir: [],
    // The shell's ONE module edge, and it is never the server — it is the three
    // facts the two processes must AGREE on, imported rather than re-stated:
    // the config resolution (the window is pinned to an origin, so the port that
    // origin names has to be the one the app itself would bind — env, then
    // `<dataDir>/config.json`, then the default; a shell with its own partial
    // copy points at a dead port), the identity primitives it verifies a
    // responder with, and the shutdown budget its SIGKILL grace must exceed.
    // Same call apps/cli's discovery makes, for the same reason. Bundled by
    // esbuild at build time, hence a devDependency rather than a runtime one.
    //
    // The contract edge is the fourth fact, and it is a WIRE fact rather than a
    // configuration one: the shell challenges a responder before adopting it, so
    // it needs the identity row's path and the schema that responder's answer is
    // held against. A shell narrowing that body for itself is a second, weaker
    // reading of the one message a squatter gets to compose.
    "@repo/desktop": ["@repo/app", "@repo/server-contract"],

    "@repo/e2e": ["@repo/app", "@repo/notes", "@repo/server-contract"],
    "@repo/repo-guards": [],
  }),
);

/**
 * ARTIFACT edges: a workspace dependency that is real in the MANIFEST and has
 * no import behind it, because the dependent INSTALLS AND EXECUTES the other
 * package's build output rather than importing its modules.
 *
 * An artifact edge means "this package is installed and executed", never
 * "this package is imported" — and the two are not degrees of the same thing.
 * `DECLARED_EDGES` above is the IMPORT graph and stays silent about these; an
 * artifact edge is deliberately absent from it, so a module import across one
 * still lands as an UNDECLARED EDGE. The assertion below says that in the
 * other direction too, because the claim is the whole point of the split.
 *
 * They need their own table because the two manifest checks read opposite
 * things off one row: pnpm must link the dependency and the packager must find
 * it, while nothing under `src/**` imports it. With no row the phantom check
 * reads the line that puts the product inside the shell as dead weight and
 * says to delete it.
 */
const DECLARED_ARTIFACT_EDGES = new Map<string, Record<string, string>>(
  Object.entries({
    "@repo/app": {
      "@repo/agent-skills":
        "the vendored Moss dialect skills are CONTENT the agent reads with its shell — agent-shell-env.ts resolves the package's skills/ directory via createRequire and hands the path to agent sessions as INTELIGIR_SKILLS_DIR; no module import exists or should",
    },
    "@repo/desktop": {
      inteligir:
        "the shell PACKS the published artifact into the .app and spawns its server entry as a CHILD PROCESS — src/main/server-paths.ts resolves it as a path under node_modules rather than importing it, and the packaged smoke reaches its staged-layout module from scripts/, which is not shipped source either",
    },
  }),
);

function artifactEdgesFrom(name: string): Record<string, string> {
  return DECLARED_ARTIFACT_EDGES.get(name) ?? {};
}

/** `node:*`, react and electron — the three platform surfaces a package can
 *  accidentally acquire, each fatal on a different target. */
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
  /** Stated in the failure, because a rule nobody can read is a rule nobody keeps. */
  why: string;
}

/**
 * What each package's shipped source may NOT reach. Absent from this table
 * means "no platform constraint" — apps and the node-side packages.
 */
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
    "@repo/server-contract": {
      forbidden: ["node", "react", "electron"],
      why: "a zod-only leaf: the same table builds the server's routes and the browser's client",
    },
    "@repo/cloud-contract": {
      forbidden: ["node", "react", "electron"],
      why: "a zod-only leaf: the cloud wire runs on workerd, where node builtins do not exist, and the local app parses the same frames",
    },
    "@repo/typed-routes": {
      forbidden: ["node", "react", "electron"],
      why: "@repo/server-contract derives from it and ships to the browser, so this rides along into every client bundle",
    },
    "@repo/thread-view": {
      forbidden: ["node", "react", "electron"],
      why: "isomorphic: the same projection folds a thread's events on the server and in any client",
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

/** zod-only means zod-only. `@repo/server-contract` and `@repo/typed-routes`
 *  are NOT on this list: both carry hono, which is isomorphic and therefore
 *  does not cost the leaves' portability. */
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

  it("the Cloudflare Worker imports no Node package", () => {
    // Derived, not listed: a package is a Node package when its shipped source
    // reaches `node:` — directly or through an edge. `nodejs_compat` shims some
    // of those modules on workerd, but not the native addons and spawned
    // processes behind them (better-sqlite3, child_process, @parcel/watcher),
    // and the failure is a deploy that builds and then throws on first request.
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
    // The whole DAG rests on this split, and it is the one thing above that a
    // rename could silently break — a suite that stopped counting as a test
    // would start contributing edges.
    expect(isTestFile("packages/db/src/__tests__/db.test.ts")).toBe(true);
    expect(isTestFile("apps/app/src/node/__tests__/boot-app.ts")).toBe(true);
    expect(isTestFile("packages/agent-runtime/src/test-support/fake-codex-adapter.ts")).toBe(true);
    expect(isTestFile("packages/db/src/schema.ts")).toBe(false);
  });
});
