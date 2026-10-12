// the shipped import graph is pinned to DECLARED_EDGES from both sides, and every import, a
// test's and a tool's included, to its importer's manifest. adding a package or an edge: add the
// row.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  importsOf,
  isTestFile,
  manifestWorkspaceDeps,
  REPO_ROOT,
  resolveWorkspace,
  sourceOf,
  workspaceFiles,
  workspaceSourceFiles,
  workspaces,
} from "./repo";
import type { Workspace } from "./repo";
import { GALLERY_DIR } from "./ui-package";

// what each workspace's shipped source may import; test-only imports are not edges but must still
// be declared in the manifest.
const DECLARED_EDGES = new Map<string, readonly string[]>(
  Object.entries({
    "@repo/agent-runtime": ["@repo/domain"],
    // a leaf: content (markdown served to agents), imported as files.
    "@repo/agent-skills": [],
    // the @repo/notes edge is the parser-free grammars the contract validates against (vault-path,
    // sidecar-schema, tag-grammar, link-kinds); widening it to a remark-carrying module drags
    // remark into every client bundle, which "the contract's @repo/notes edge" below walks for.
    "@repo/contract": ["@repo/domain", "@repo/notes"],
    // below the wire: an edge to @repo/contract would drag @orpc/contract and the contract's notes edge
    // into a package that only writes rows.
    "@repo/db": ["@repo/domain"],
    // the shell is Rust (src-tauri) and holds no src/: the page it shows is @repo/workspace's, and
    // every rule it shares with the server it asks the CLI's desktop entry for.
    "@repo/desktop": [],
    "@repo/domain": [],
    // the `inteligir` edge is the binary it spawns and the config resolution naming this checkout's
    // instance; the @repo/mobile edge is the phone's own platform-free runtime, driven under node
    // against a real Worker, since no Expo boots headless; the @repo/mobile-editor edge is the
    // bridge's protocol, so the scripted phone speaks the frames the page parses.
    "@repo/e2e": ["@repo/contract", "@repo/mobile", "@repo/mobile-editor", "inteligir"],
    // the editor draws with the shared component kit; @repo/ui stays a leaf below it.
    "@repo/editor": ["@repo/notes", "@repo/ui"],
    // a partial cloud client: reads the thread log and produces captures, never pushes or claims,
    // and writes the vault only through the guarded commit route. the @repo/notes edge is the
    // dialect's own parse, link resolver and the one conflict verdict its write queue settles
    // with; the @repo/mobile-editor edge is the editor page's wire alone (EDITOR_PAGE_CLIENTS
    // below), since the page itself ships built; it reaches no server, vault engine or agent.
    "@repo/mobile": ["@repo/contract", "@repo/domain", "@repo/mobile-editor", "@repo/notes"],
    // the phone's editor page: the desktop's editor in a WebView, reaching the phone only through
    // its own bridge, so no contract and no cloud wire.
    "@repo/mobile-editor": ["@repo/editor", "@repo/notes", "@repo/ui"],
    "@repo/notes": [],
    "@repo/repo-guards": [],
    "@repo/ui": [],
    // a dev page no row names, so an import of it from a shipped workspace fails here.
    "@repo/ui-gallery": ["@repo/ui"],
    "@repo/web": ["@repo/contract", "@repo/ui"],
    // the page every vault's server answers and the first run the shell carries; it reaches no
    // server and no shell source, only the wire to each. Its suites that boot a server live in
    // apps/cli, so nothing here depends on `inteligir`.
    "@repo/workspace": [
      "@repo/contract",
      "@repo/domain",
      "@repo/editor",
      "@repo/notes",
      "@repo/ui",
    ],
    // the server reaches no page: no @repo/ui, no @repo/editor, no react.
    inteligir: ["@repo/agent-runtime", "@repo/contract", "@repo/db", "@repo/domain", "@repo/notes"],
  }),
);

// the desktop shell's own API, which answers only inside the shell's window: only the page that
// window shows may reach it, so the rule is who may, not a row per package that may not
const SHELL_API = "@tauri-apps/";
const SHELL_API_CLIENTS = new Set(["@repo/workspace"]);

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

// The phone's editor page is DOM React built by Vite; a native client that hosts it reaches the
// bridge's wire alone and loads the page as a built bundle. Any other import would compile DOM
// code a second way, under the client's own bundler and TypeScript.
const EDITOR_PAGE_WIRE = "@repo/mobile-editor/bridge-protocol";
const EDITOR_PAGE_CLIENTS = new Map<string, string>([
  [
    "@repo/mobile",
    "React Native under Metro and TypeScript 6, hosting the page in a WebView from the app bundle",
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

// the deepest dir wins, so a workspace nested in another owns its own files
const workspaceAt = (relativePath: string): Workspace | null =>
  workspaces()
    .filter(
      (workspace) => relativePath === workspace.dir || relativePath.startsWith(`${workspace.dir}/`),
    )
    .toSorted((a, b) => b.dir.length - a.dir.length)[0] ?? null;

// the workspace a relative specifier lands in, when it is not the importer's own
const pathIntoAnotherWorkspace = (file: string, specifier: string): Workspace | null => {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const [bare = specifier] = specifier.split("?");
  const target = workspaceAt(path.posix.join(path.posix.dirname(file), bare));
  return target === null || target.name === workspaceAt(file)?.name ? null : target;
};

const shippedEdges = new Map<string, Map<string, string[]>>();
const testEdges = new Map<string, Map<string, string[]>>();
// a workspace's own tooling outside src/, its scripts and configs: like a test's, what it imports
// is a dependency the manifest declares, never an edge. The desktop's scripts are the whole of its
// TypeScript.
const toolingEdges = new Map<string, Map<string, string[]>>();
for (const workspace of workspaces()) {
  const files = workspaceFiles(workspace);
  const inSrc = new Set([...files.shipped, ...files.test]);
  shippedEdges.set(workspace.name, edgesFrom(workspace, files.shipped));
  testEdges.set(workspace.name, edgesFrom(workspace, files.test));
  toolingEdges.set(
    workspace.name,
    edgesFrom(
      workspace,
      workspaceSourceFiles(workspace).filter((file) => !inSrc.has(file)),
    ),
  );
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

  // knip owns the reverse, a listed workspace nothing imports, but not this: outside --strict, which
  // stops counting devDependencies, it accepts any workspace package a private workspace imports.
  it("every imported workspace is declared in the importer's manifest", () => {
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      const declared = manifestWorkspaceDeps(workspace.manifest);
      for (const bucket of [shippedEdges, testEdges, toolingEdges]) {
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

  // every other rule in this file reads a package name, so a relative path into another workspace
  // would pass them all unseen.
  it("a workspace reaches another only by its package name", () => {
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      for (const file of workspaceSourceFiles(workspace)) {
        for (const specifier of importsOf(file)) {
          const target = pathIntoAnotherWorkspace(file, specifier);
          if (target === null) {
            continue;
          }
          violations.push(
            `PATH INTO ANOTHER WORKSPACE  ${file} imports "${specifier}", a file of ${target.name}\n` +
              `  rule: a workspace reaches another by its package name alone — a relative path skips that workspace's exports, its DECLARED_EDGES row and the importer's manifest, so every edge and reach check here passes it\n` +
              `  fix: import it as "${target.name}/…" through its exports, the edge declared in DECLARED_EDGES and ${workspace.dir}/package.json`,
          );
        }
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("sees a relative path into the gallery, so a clean sweep is a real one", () => {
    const importer = "apps/web/src/routes/index.tsx";
    const intoGallery = `${path.posix.relative(path.posix.dirname(importer), GALLERY_DIR)}/src/gallery-page`;
    expect(pathIntoAnotherWorkspace(importer, intoGallery)?.name).toBe("@repo/ui-gallery");
    expect(pathIntoAnotherWorkspace(importer, "../../../../docs/privacy.md?raw")).toBeNull();
    expect(pathIntoAnotherWorkspace(importer, "../router")).toBeNull();
    expect(pathIntoAnotherWorkspace(importer, "@repo/ui/components/button")).toBeNull();
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
  it("only the page the shell shows reaches the shell's API", () => {
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      if (SHELL_API_CLIENTS.has(workspace.name)) {
        continue;
      }
      const files = workspaceFiles(workspace);
      for (const file of [...files.shipped, ...files.test]) {
        for (const specifier of importsOf(file)) {
          if (specifier.startsWith(SHELL_API)) {
            violations.push(
              `SHELL API OUTSIDE THE PAGE  ${file} imports "${specifier}"\n` +
                `  rule: Tauri answers only inside the desktop shell's window, so only ${[...SHELL_API_CLIENTS].join(", ")}, the page it shows, reaches it`,
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

  it("every editor page client reaches the page's wire and nothing else of it", () => {
    const violations: string[] = [];
    for (const [name, why] of EDITOR_PAGE_CLIENTS) {
      const client = workspaces().find((candidate) => candidate.name === name);
      if (client === undefined) {
        violations.push(
          `EDITOR_PAGE_CLIENTS ROW NAMES NO WORKSPACE  ${name}\n` +
            `  rule: a pin on a workspace that is gone pins nothing — delete the row from tools/repo-guards/src/dep-dag.test.ts`,
        );
        continue;
      }
      const files = workspaceFiles(client);
      for (const file of [...files.shipped, ...files.test]) {
        for (const specifier of importsOf(file)) {
          if (resolveWorkspace(specifier)?.name !== "@repo/mobile-editor") {
            continue;
          }
          if (specifier === EDITOR_PAGE_WIRE) {
            continue;
          }
          violations.push(
            `EDITOR PAGE SOURCE IN ITS HOST  ${file} imports "${specifier}"\n` +
              `  rule: ${name} reaches ${EDITOR_PAGE_WIRE} alone — ${why}`,
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
              `  rule: @repo/contract/cloud is the never-break wire — it may import zod, @repo/notes and its own cloud/ modules, never src/local`,
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

// `import type` ships nothing, so a type-only edge loads no module
const RUNTIME_IMPORT =
  /\bimport\s*\(\s*["'](?<dynamic>[^"'\n]+)["']|\b(?:import|export)\s+(?<typeOnly>type\s+)?(?:[\w$*{}\s,]+?\s+from\s*)?["'](?<specifier>[^"'\n]+)["']/gu;

const runtimeImportsOf = (file: string): string[] => {
  const specifiers: string[] = [];
  for (const match of sourceOf(file).matchAll(RUNTIME_IMPORT)) {
    const found =
      match.groups?.dynamic ??
      (match.groups?.typeOnly === undefined ? match.groups?.specifier : undefined);
    if (found !== undefined) {
      specifiers.push(found);
    }
  }
  return specifiers;
};

const MARKDOWN_PARSER = /^(?:remark-|unified$|micromark|mdast-util-)/u;

const NOTES_DIR = "packages/notes";

const notesExports = z
  .object({ exports: z.record(z.string(), z.string()) })
  .parse(
    JSON.parse(fs.readFileSync(path.join(REPO_ROOT, NOTES_DIR, "package.json"), "utf-8")),
  ).exports;

const notesExportFile = (specifier: string): string | null => {
  const target = specifier.startsWith("@repo/notes/")
    ? notesExports[`./${specifier.slice("@repo/notes/".length)}`]
    : undefined;
  return target === undefined ? null : path.posix.join(NOTES_DIR, target);
};

const resolveRelative = (from: string, specifier: string): string | null => {
  const base = path.posix.join(path.posix.dirname(from), specifier);
  return (
    [base, `${base}.ts`, `${base}.tsx`, path.posix.join(base, "index.ts")].find((candidate) => {
      const full = path.join(REPO_ROOT, candidate);
      return fs.existsSync(full) && fs.statSync(full).isFile();
    }) ?? null
  );
};

interface ParserReach {
  chain: string[];
  specifier: string;
}

// the first markdown-parser import in the module's runtime closure, and the files that lead to it
const markdownParserReach = (entry: string): ParserReach | null => {
  const seen = new Set<string>();
  const visit = (file: string, chain: readonly string[]): ParserReach | null => {
    if (seen.has(file)) {
      return null;
    }
    seen.add(file);
    const here = [...chain, file];
    for (const specifier of runtimeImportsOf(file)) {
      if (MARKDOWN_PARSER.test(specifier)) {
        return { chain: here, specifier };
      }
      const next = specifier.startsWith(".")
        ? resolveRelative(file, specifier)
        : notesExportFile(specifier);
      const found = next === null ? null : visit(next, here);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };
  return visit(entry, []);
};

describe("the contract's @repo/notes edge", () => {
  it("reaches no markdown parser", () => {
    const contract = workspaces().find((candidate) => candidate.name === "@repo/contract");
    if (contract === undefined) {
      throw new Error("@repo/contract is not a workspace");
    }
    const violations: string[] = [];
    for (const file of workspaceFiles(contract).shipped) {
      for (const specifier of runtimeImportsOf(file)) {
        if (!specifier.startsWith("@repo/notes/")) {
          continue;
        }
        const entry = notesExportFile(specifier);
        if (entry === null) {
          violations.push(
            `UNRESOLVED NOTES IMPORT  ${file} imports "${specifier}"\n` +
              `  rule: every @repo/notes specifier the contract imports is a row in ${NOTES_DIR}/package.json's exports, or this walk cannot follow it`,
          );
          continue;
        }
        const reach = markdownParserReach(entry);
        if (reach !== null) {
          violations.push(
            `MARKDOWN PARSER IN THE CONTRACT  ${file} imports "${specifier}", which loads "${reach.specifier}"\n` +
              `  via ${reach.chain.join(" -> ")}\n` +
              `  rule: @repo/contract's @repo/notes edge is the parser-free grammars the contract validates against — the contract loads in every client, so a remark-carrying module drags the markdown parser into every bundle\n` +
              `  fix: move what the contract needs into an import-free module beside it, as tag-grammar.ts and link-kinds.ts are`,
          );
        }
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("sees the parser behind the scan, so a clean walk is a real one", () => {
    const scan = notesExportFile("@repo/notes/knowledge/link-extract");
    expect(scan).not.toBeNull();
    expect(scan === null ? null : markdownParserReach(scan)?.specifier).toMatch(MARKDOWN_PARSER);
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
