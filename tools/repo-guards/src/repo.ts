// The one tree walk every guard in this workspace shares: which workspaces
// exist, which of their files SHIP, and what each file imports.
//
// Nothing here is a list. Workspaces come from the pnpm globs' own layout on
// disk, shipped files from a walk, and imports from the source — so a guard
// built on this cannot be satisfied by editing the guard.

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

export const WORKSPACE_MANIFEST = "pnpm-workspace.yaml";

/** Directories no guard walks: dependencies, and build output that would be
 *  read as source. Shared, because a guard with its own shorter list passes on
 *  CI and fails on a machine that has run a build. */
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "dist-node", "coverage"]);

/**
 * Directories a guard must not walk. Dot-directories are excluded wholesale
 * rather than listed: none of pnpm's globs reaches one, so anything in there
 * is tooling state (`.turbo`, `.cache`), an ignored sidecar (`.ds-sync`), or —
 * worst for a guard — an agent worktree under `.claude`, which is a whole
 * checkout of THIS repo and would be read as if it were this commit's tree.
 */
export function isSkippedDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIR_NAMES.has(name);
}

const SOURCE_FILE = /\.(?:tsx?|mts|cts|mjs|cjs|jsx?)$/;

/** A dependency group that is not a name→range map is dropped rather than
 *  read partially — the original reader skipped malformed groups the same way. */
const versionMapSchema = z.record(z.string(), z.string()).optional().catch(undefined);

const manifestSchema = z.object({
  name: z.string(),
  dependencies: versionMapSchema,
  devDependencies: versionMapSchema,
  peerDependencies: versionMapSchema,
});

export type Manifest = z.infer<typeof manifestSchema>;

export interface Workspace {
  /** The manifest's `name`, e.g. `@repo/notes` — the id every guard speaks. */
  name: string;
  /** Repo-relative directory, e.g. `packages/notes`. */
  dir: string;
  manifest: Manifest;
}

/** Parse at the boundary: a manifest is JSON on disk, so a shape this cannot
 *  reason about is refused rather than read through `any`. */
function parseManifest(file: string): Manifest {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const manifest = manifestSchema.safeParse(value);
  if (!manifest.success) {
    throw new Error(`${file}: expected a package.json with a string "name"`);
  }
  return manifest.data;
}

export interface WorkspaceGlobs {
  /** `apps/*` → `apps`: every child directory of it is a candidate workspace. */
  groups: string[];
  /** A bare `docs` → `docs`: the directory IS the workspace. */
  standalone: string[];
}

let cachedGlobs: WorkspaceGlobs | undefined;

/**
 * The workspace globs, read from pnpm's own manifest rather than restated.
 *
 * A guard that carries its own copy stops covering a workspace group the day
 * one is added, and the symptom is silence — every assertion still passes,
 * over a smaller tree. Only the two glob shapes this repo uses are understood;
 * anything else THROWS, because the alternative is skipping it quietly, which
 * is the failure this reader exists to remove.
 */
export function workspaceGlobs(): WorkspaceGlobs {
  if (cachedGlobs !== undefined) return cachedGlobs;
  const parsed = z
    .looseObject({ packages: z.array(z.unknown()) })
    .safeParse(parseYaml(fs.readFileSync(path.join(REPO_ROOT, WORKSPACE_MANIFEST), "utf8")));
  if (!parsed.success) {
    throw new Error(`${WORKSPACE_MANIFEST}: expected a "packages" list of workspace globs`);
  }
  const groups: string[] = [];
  const standalone: string[] = [];
  for (const packagesEntry of parsed.data.packages) {
    const entry = z.string().safeParse(packagesEntry);
    if (!entry.success) {
      throw new Error(`${WORKSPACE_MANIFEST}: every "packages" entry must be a string`);
    }
    const glob = entry.data.replace(/\/+$/, "");
    if (glob.endsWith("/*") && !glob.slice(0, -2).includes("*")) {
      groups.push(glob.slice(0, -2));
    } else if (!glob.includes("*") && !glob.startsWith("!")) {
      standalone.push(glob);
    } else {
      throw new Error(
        `${WORKSPACE_MANIFEST}: cannot read the workspace glob "${entry.data}".\n` +
          `  rule: tools/repo-guards/src/repo.ts derives every guard's tree walk from this list, and understands "<dir>/*" and a plain "<dir>" only\n` +
          `  fix: teach workspaceGlobs() this shape — leaving it unread would silently shrink what every guard covers`,
      );
    }
  }
  cachedGlobs = { groups, standalone };
  return cachedGlobs;
}

let cachedWorkspaces: Workspace[] | undefined;

/** Every workspace in the repo, discovered from the pnpm globs' own layout. */
export function workspaces(): Workspace[] {
  if (cachedWorkspaces !== undefined) return cachedWorkspaces;
  const globs = workspaceGlobs();
  const dirs: string[] = [...globs.standalone];
  for (const group of globs.groups) {
    const groupDir = path.join(REPO_ROOT, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.posix.join(group, entry.name));
    }
  }
  const found: Workspace[] = [];
  for (const dir of dirs) {
    const manifestPath = path.join(REPO_ROOT, dir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = parseManifest(manifestPath);
    found.push({ name: manifest.name, dir, manifest });
  }
  cachedWorkspaces = found.toSorted((a, b) => a.name.localeCompare(b.name));
  return cachedWorkspaces;
}

/**
 * Every WORKSPACE this manifest declares, in any dependency group.
 *
 * Membership is decided by `workspaces()`, never by a name prefix. A prefix
 * filter reads the repo's naming CONVENTION as if it were the repo's layout,
 * and the one workspace that breaks the convention is the published artifact —
 * `inteligir` — which is exactly the dependency a shipping surface installs.
 * Filtering on `@repo/` made that declaration invisible to both manifest
 * checks: neither the missing-dependency one nor the phantom one could see it.
 */
export function manifestWorkspaceDeps(manifest: Manifest): Set<string> {
  const all = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  };
  const names = new Set(workspaces().map((workspace) => workspace.name));
  return new Set(Object.keys(all).filter((name) => names.has(name)));
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) continue;
      walk(full, out);
    } else if (SOURCE_FILE.test(entry.name)) {
      out.push(path.relative(REPO_ROOT, full));
    }
  }
}

/** A file that never reaches a user: a suite, a fixture, or a test-only port. */
export function isTestFile(relativePath: string): boolean {
  return (
    /(?:^|\/)__tests__\//.test(relativePath) ||
    /(?:^|\/)test-support\//.test(relativePath) ||
    /\.test\.[cm]?tsx?$/.test(relativePath)
  );
}

export interface WorkspaceFiles {
  /** `src/**` minus the test files — what a consumer of this package runs. */
  shipped: string[];
  test: string[];
}

const cachedFiles = new Map<string, WorkspaceFiles>();

/**
 * A workspace's source, split by whether it ships. SHIPPED is `src/**` only:
 * build scripts, vite/vitest configs and the editor's `dev/` demo live outside
 * it and are not what a dependent gets.
 */
export function workspaceFiles(workspace: Workspace): WorkspaceFiles {
  const cached = cachedFiles.get(workspace.name);
  if (cached !== undefined) return cached;
  const all: string[] = [];
  walk(path.join(REPO_ROOT, workspace.dir, "src"), all);
  const files: WorkspaceFiles = {
    shipped: all.filter((file) => !isTestFile(file)),
    test: all.filter((file) => isTestFile(file)),
  };
  cachedFiles.set(workspace.name, files);
  return files;
}

const cachedWorkspaceSources = new Map<string, string[]>();

/**
 * Every source file a workspace CONTAINS, wherever it sits — `src/`, the build
 * and smoke scripts beside it, a config at its root.
 *
 * `workspaceFiles` answers what SHIPS, which is the population a dependency
 * edge is about. This answers what the repo HOLDS, which is the population a
 * guard about SPELLING needs: a smoke script that hand-writes a route path
 * drifts from the table exactly the way a handler does, and it lives nowhere
 * near `src/`.
 */
export function workspaceSourceFiles(workspace: Workspace): string[] {
  const cached = cachedWorkspaceSources.get(workspace.name);
  if (cached !== undefined) return cached;
  const found: string[] = [];
  walk(path.join(REPO_ROOT, workspace.dir), found);
  const sorted = found.toSorted();
  cachedWorkspaceSources.set(workspace.name, sorted);
  return sorted;
}

const FULL_LINE_COMMENT = /^\s*(?:\/\/|\*|\/\*)/;
const IMPORT_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["']([^"'\n]+)["']/g;

const cachedSources = new Map<string, string>();

/**
 * A file's source with its full-line comments dropped — the bytes every guard
 * in this workspace reads, so two guards can never disagree about what a file
 * says. Prose naming a package or a change kind therefore cannot invent one; a
 * TRAILING comment is left alone, because stripping one safely would mean
 * parsing the line, and a walk that eats real code fails OPEN, which is the one
 * failure mode a fitness test may not have.
 */
export function sourceOf(relativePath: string): string {
  const cached = cachedSources.get(relativePath);
  if (cached !== undefined) return cached;
  const source = fs
    .readFileSync(path.join(REPO_ROOT, relativePath), "utf8")
    .split("\n")
    .filter((line) => !FULL_LINE_COMMENT.test(line))
    .join("\n");
  cachedSources.set(relativePath, source);
  return source;
}

/**
 * Every module specifier a file imports — static, `export … from`, dynamic and
 * `require`.
 */
export function importsOf(relativePath: string): string[] {
  const source = sourceOf(relativePath);
  const specifiers: string[] = [];
  IMPORT_SPECIFIER.lastIndex = 0;
  let match = IMPORT_SPECIFIER.exec(source);
  while (match !== null) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.push(specifier);
    match = IMPORT_SPECIFIER.exec(source);
  }
  return specifiers;
}

/** Which workspace a specifier resolves to, or null for an npm/builtin one. */
export function resolveWorkspace(specifier: string): Workspace | null {
  return (
    workspaces().find(
      (workspace) => specifier === workspace.name || specifier.startsWith(`${workspace.name}/`),
    ) ?? null
  );
}
