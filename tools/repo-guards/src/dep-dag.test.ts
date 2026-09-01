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

/**
 * THE table: which workspaces each workspace's SHIPPED source may import.
 * Test-only imports are not edges — a suite reaching for a fixture package says
 * nothing about what a consumer of this package pulls in — but they must still
 * be declared in the manifest, which the manifest test below covers.
 */
const DECLARED_EDGES = new Map<string, readonly string[]>(
  Object.entries({
    // Leaves. Nothing in this repo may be below them.
    // agent-skills is CONTENT (the dialect spec, issue #581) —
    // markdown served to agents, importing nothing and imported as files.
    "@repo/agent-skills": [],
    "@repo/domain": [],
    "@repo/notes": [],
    "@repo/ui": [],

    // The Plate editor draws with the shared component kit — the same
    // shadcn-on-Base-UI vocabulary the app's chrome uses — so the edge is a
    // rendering dependency, not a domain one. @repo/ui stays a leaf below it.
    "@repo/editor": ["@repo/notes", "@repo/ui"],
    // ONE contract package, TWO entry points, and the split is the point: its
    // `/local` half is the desktop renderer and the CLI talking to the local
    // server, whose two ends ship in one bundle and may break freely; its
    // `/cloud` half is a deployed Worker answering installs that may be months
    // stale, and may never break. `/cloud` is more than schemas and paths: it
    // carries the pure CLIENT MACHINE too — the pairing flow's slot and
    // PKCE-bound redeem, the sync session's fence and page loop — because
    // those are security-bearing disciplines every platform must run
    // identically, and a machine with a copy per platform is one per platform
    // to audit.
    //
    // The @repo/notes edge is the grammars the contract validates against —
    // the vault path (`knowledge/vault-path`) and the comment id and source
    // (`comments/sidecar-schema`) — and it is narrow ON PURPOSE: both modules
    // are parser-free, so refusing a bad value in the contract cannot drag
    // remark into every client bundle. Widening this edge to a
    // remark-carrying module is the regression to catch.
    // `/local` reaching `/cloud` inside this package is ONE fact, and it is a
    // wire fact: the device name `cloud.pairBegin` accepts is the name the
    // cloud's own `/v1/device/redeem` will eventually be sent, so the ceiling
    // it validates against has to be that route's. A hand-copied number would
    // be a value this end accepts and the cloud then refuses, arriving as a
    // shape error long after the click that caused it.
    "@repo/api": ["@repo/domain", "@repo/notes"],
    "@repo/agent-runtime": ["@repo/domain"],
    // Persistence sits BELOW the wire: the store announces its writes through
    // @repo/domain's `DbNotifier`, whose change-kind vocabulary the contract
    // serializes. An edge the other way would drag hono, the route machinery and
    // the contract's own @repo/notes edge into the build graph of a package that
    // only writes rows.
    "@repo/db": ["@repo/domain"],

    // THE SERVER, and the binary that runs it. `serve` is the whole local
    // process — vault, index, agent, API — and every other verb is a client of
    // one, so this workspace composes nearly everything. What it does NOT
    // reach is the page: no @repo/ui, no @repo/editor, no react.
    inteligir: [
      "@repo/agent-runtime",
      // ONE edge, BOTH entry points: `/local` is the contract this program
      // serves, and `/cloud` is the wire it is a CLIENT of — the
      // sync client parses the same push/pull/capture schemas, ws ping frames
      // and error envelope apps/web produces, so the contract has two
      // implementations and no second reading.
      "@repo/api",
      "@repo/db",
      "@repo/domain",
      "@repo/notes",
    ],
    // The mobile companion. It is a PARTIAL client of the cloud
    // wire — a reader of the account's merged thread log and a producer of
    // captures — over React Native storage instead of better-sqlite3. It never
    // pushes a thread event and never claims a capture: the desktop runs the
    // turns and owns applying a capture to the vault, so each of those halves
    // has exactly one client. What both readers of the log DO share is the
    // contract's client machine — the page planner (`cloud/sync/plan-page`),
    // the session fence (`cloud/sync/sync-session`) and the pairing flow
    // (`cloud/pairing/pairing-flow`) — two copies of any of them would be two
    // answers to "did this row move the cursor?" or two security machines to
    // audit, and a mis-set cursor is a duplicated conversation. The @repo/domain edge
    // is the ThreadEvent grammar the planner hands back and this client folds
    // into display rows. Both are zod-only leaves, so the edge costs the RN
    // bundle only the schemas it already parses.
    //
    // The @repo/notes edge is the vault READ surface: the phone renders notes
    // from the hosted vault through the dialect's OWN parse and
    // resolves wiki links with the same pickBest as the desktop — a second
    // parser or resolver would drift per device. The package is guard-pure
    // (no node/react — the platform rules below), so the edge carries only
    // remark and the resolvers. What the phone still reaches NOTHING of: the
    // local server, the apps/web worker, the vault ENGINE (git, watcher,
    // sqlite index) and the agent — those stay on the desktop.
    "@repo/mobile": ["@repo/api", "@repo/domain", "@repo/notes"],
    // The Cloudflare Worker. Only the two packages it can survive on workerd —
    // see the workerd rule below for what enforces that beyond this row.
    "@repo/web": ["@repo/api", "@repo/ui"],
    // THE SHIPPED PRODUCT: the window, and the page inside it. The renderer is
    // this workspace's own source, so the whole UI vocabulary lives on this row
    // — and `inteligir` is here for FOUR facts the two processes must agree on
    // rather than re-state: the config resolution (a shell with its own partial
    // copy resolves a different instance than the server it forks), the device
    // token's file and header spelling, the shutdown budget its stop grace must
    // exceed, and the renderer's own policy, which the protocol handler serves
    // and the server's browser door serves identically. The shell ALSO forks
    // that package's bundle as a child — but a dependency with a real importer
    // is an ordinary edge, so it is declared once, here.
    "@repo/desktop": [
      "@repo/api",
      "@repo/domain",
      "@repo/editor",
      "@repo/notes",
      "@repo/ui",
      "inteligir",
    ],

    // Boots a REAL server and drives it over the typed client; the `inteligir`
    // edge is the binary it spawns and the config resolution that says which
    // instance this checkout means.
    "@repo/e2e": ["@repo/api", "inteligir"],
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
 * things off one row: pnpm must link the dependency, while nothing under
 * `src/**` imports it. With no row the phantom check reads the line that puts
 * the agent's skills inside the artifact as dead weight and says to delete it.
 */
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

/** zod-only means zod-only. `@repo/api` is NOT on this list: it carries
 *  `@orpc/contract`, which is isomorphic and therefore does not cost the
 *  leaves' portability. */
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
    // ONE package, TWO entry points, and the split only means something if the
    // halves stay apart. `/cloud` is a deployed Worker answering installs that
    // may be months stale and may never break; `/local` is the desktop's own
    // renderer and CLI, which ship in one bundle and break freely. A Worker
    // reaching a `/local` symbol is that freedom quietly becoming a promise.
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
    // The mirror of the Worker pin, enforced from INSIDE the package. apps/web
    // imports only `@repo/api/cloud/*` — but a file UNDER src/cloud reaching
    // src/local by a relative path (or by the package's own name) is invisible
    // to that check and would drag a may-break-freely /local shape into the
    // never-break cloud wire through every cloud import the Worker makes. The
    // one sanctioned crossing is the OTHER direction (local/cloud reuses a
    // cloud constant), which this does not touch.
    const api = workspaces().find((candidate) => candidate.name === "@repo/api");
    if (api === undefined) throw new Error("@repo/api is not a workspace");
    const cloudDir = join(api.dir, "src", "cloud");
    const localDir = join(api.dir, "src", "local");
    const files = workspaceFiles(api);
    const violations: string[] = [];
    for (const file of [...files.shipped, ...files.test]) {
      // TWO buckets and no third. This guard populates itself from src/cloud,
      // so a file outside both halves is one it cannot see — reachable from
      // cloud, free to import local, and caught by neither pin.
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
    expect(isTestFile("apps/cli/src/server/__tests__/boot-app.ts")).toBe(true);
    expect(isTestFile("packages/agent-runtime/src/test-support/fake-acp-agent.mjs")).toBe(true);
    expect(isTestFile("packages/db/src/schema.ts")).toBe(false);
  });
});
