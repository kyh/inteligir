// The one tree walk every guard in this workspace shares: which workspaces
// exist, which of their files SHIP, and what each file imports.
//
// Nothing here is a list. Workspaces come from the pnpm globs' own layout on
// disk, shipped files from a walk, and imports from the source — so a guard
// built on this cannot be satisfied by editing the guard.

import fs from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Where the pnpm workspace globs land. `e2e` is its own workspace, not a glob. */
const WORKSPACE_GROUPS = ["apps", "packages", "tools"];
const STANDALONE_WORKSPACES = ["e2e"];

/** Directories no guard walks: dependencies, and build output that would be
 *  read as source. Shared, because a guard with its own shorter list passes on
 *  CI and fails on a machine that has run a build. */
export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "dist-node",
  ".cache",
  ".turbo",
  ".tanstack",
  ".wrangler",
  ".output",
  ".git",
  "coverage",
]);

const SOURCE_FILE = /\.(?:tsx?|mts|cts|mjs|cjs|jsx?)$/;

export interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface Workspace {
  /** The manifest's `name`, e.g. `@repo/notes` — the id every guard speaks. */
  name: string;
  /** Repo-relative directory, e.g. `packages/notes`. */
  dir: string;
  manifest: Manifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVersionMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

/** Parse at the boundary: a manifest is JSON on disk, so a shape this cannot
 *  reason about is refused rather than read through `any`. */
function parseManifest(file: string): Manifest {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(value) || typeof value.name !== "string") {
    throw new Error(`${file}: expected a package.json with a string "name"`);
  }
  const manifest: Manifest = { name: value.name };
  if (isVersionMap(value.dependencies)) manifest.dependencies = value.dependencies;
  if (isVersionMap(value.devDependencies)) manifest.devDependencies = value.devDependencies;
  if (isVersionMap(value.peerDependencies)) manifest.peerDependencies = value.peerDependencies;
  return manifest;
}

let cachedWorkspaces: Workspace[] | undefined;

/** Every workspace in the repo, discovered from the directory layout. */
export function workspaces(): Workspace[] {
  if (cachedWorkspaces !== undefined) return cachedWorkspaces;
  const dirs: string[] = [...STANDALONE_WORKSPACES];
  for (const group of WORKSPACE_GROUPS) {
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

/** Every `@repo/*` name the manifest declares, in any dependency group. */
export function manifestWorkspaceDeps(manifest: Manifest): Set<string> {
  const all = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  };
  return new Set(Object.keys(all).filter((name) => name.startsWith("@repo/")));
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
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
