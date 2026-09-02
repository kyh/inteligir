import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

export const WORKSPACE_MANIFEST = "pnpm-workspace.yaml";

// shared: a guard with its own shorter list passes on CI and fails on a machine that has run a
// build.
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "coverage"]);

// dot-directories wholesale: none of pnpm's globs reaches one, and an agent worktree under .claude
// is a whole checkout of this repo that would be read as this commit's tree.
export function isSkippedDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIR_NAMES.has(name);
}

const SOURCE_FILE = /\.(?:tsx?|mts|cts|mjs|cjs|jsx?)$/;

const STYLE_FILE = /\.css$/;

const versionMapSchema = z.record(z.string(), z.string()).optional().catch(undefined);

const manifestSchema = z.object({
  name: z.string(),
  dependencies: versionMapSchema,
  devDependencies: versionMapSchema,
  peerDependencies: versionMapSchema,
});

export type Manifest = z.infer<typeof manifestSchema>;

export interface Workspace {
  name: string;
  dir: string;
  manifest: Manifest;
}

function parseManifest(file: string): Manifest {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const manifest = manifestSchema.safeParse(value);
  if (!manifest.success) {
    throw new Error(`${file}: expected a package.json with a string "name"`);
  }
  return manifest.data;
}

export interface WorkspaceGlobs {
  // `apps/*` → `apps`: every child directory is a candidate workspace.
  groups: string[];
  // a bare `docs` → `docs`: the directory is the workspace.
  standalone: string[];
}

let cachedGlobs: WorkspaceGlobs | undefined;

// read from pnpm's own manifest: a copy stops covering a group the day one is added, and the
// symptom is a green run over a smaller tree. an unknown glob shape throws rather than being
// skipped.
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

// membership by workspaces(), never by name prefix: `inteligir` breaks the @repo/ convention and is
// exactly the dependency a shipping surface installs.
export function manifestWorkspaceDeps(manifest: Manifest): Set<string> {
  const all = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  };
  const names = new Set(workspaces().map((workspace) => workspace.name));
  return new Set(Object.keys(all).filter((name) => names.has(name)));
}

function walk(dir: string, matches: RegExp, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) continue;
      walk(full, matches, out);
    } else if (matches.test(entry.name)) {
      out.push(path.relative(REPO_ROOT, full));
    }
  }
}

export function isTestFile(relativePath: string): boolean {
  return (
    /(?:^|\/)__tests__\//.test(relativePath) ||
    /(?:^|\/)test-support\//.test(relativePath) ||
    /\.test\.[cm]?tsx?$/.test(relativePath)
  );
}

export interface WorkspaceFiles {
  shipped: string[];
  test: string[];
}

const cachedFiles = new Map<string, WorkspaceFiles>();

// shipped is `src/**` only: build scripts, configs and the editor's dev/ demo are not what a
// dependent gets.
export function workspaceFiles(workspace: Workspace): WorkspaceFiles {
  const cached = cachedFiles.get(workspace.name);
  if (cached !== undefined) return cached;
  const all: string[] = [];
  walk(path.join(REPO_ROOT, workspace.dir, "src"), SOURCE_FILE, all);
  const files: WorkspaceFiles = {
    shipped: all.filter((file) => !isTestFile(file)),
    test: all.filter((file) => isTestFile(file)),
  };
  cachedFiles.set(workspace.name, files);
  return files;
}

const cachedWorkspaceSources = new Map<string, string[]>();

// what the workspace holds rather than ships: a smoke script that hand-writes a route path drifts
// like a handler does, and lives nowhere near src/.
export function workspaceSourceFiles(workspace: Workspace): string[] {
  const cached = cachedWorkspaceSources.get(workspace.name);
  if (cached !== undefined) return cached;
  const found: string[] = [];
  walk(path.join(REPO_ROOT, workspace.dir), SOURCE_FILE, found);
  const sorted = found.toSorted();
  cachedWorkspaceSources.set(workspace.name, sorted);
  return sorted;
}

const cachedWorkspaceStyles = new Map<string, string[]>();

// the same walk and skip list as the source, or a build output answers for one half of a token
// pair.
export function styleFiles(workspace: Workspace): string[] {
  const cached = cachedWorkspaceStyles.get(workspace.name);
  if (cached !== undefined) return cached;
  const found: string[] = [];
  walk(path.join(REPO_ROOT, workspace.dir), STYLE_FILE, found);
  const sorted = found.toSorted();
  cachedWorkspaceStyles.set(workspace.name, sorted);
  return sorted;
}

const FULL_LINE_COMMENT = /^\s*(?:\/\/|\*|\/\*)/;
const IMPORT_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["']([^"'\n]+)["']/g;

const cachedSources = new Map<string, string>();

// full-line comments dropped, so prose naming a package or a change kind cannot invent one; a
// trailing comment is left alone because stripping it safely means parsing the line, and eating
// real code fails open.
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

export function resolveWorkspace(specifier: string): Workspace | null {
  return (
    workspaces().find(
      (workspace) => specifier === workspace.name || specifier.startsWith(`${workspace.name}/`),
    ) ?? null
  );
}
