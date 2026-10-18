import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

export const WORKSPACE_MANIFEST = "pnpm-workspace.yaml";

// shared: a guard with its own shorter list passes on CI and fails on a machine that has run a
// build. `target` is cargo's (apps/desktop/src-tauri/target), gigabytes once the shell is built.
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "coverage", "target"]);

// dot-directories wholesale: none of pnpm's globs reaches one, and an agent worktree under .claude
// is a whole checkout of this repo that would be read as this commit's tree.
export const isSkippedDir = (name: string): boolean =>
  name.startsWith(".") || SKIP_DIR_NAMES.has(name);

const SOURCE_FILE = /\.(?:tsx?|mts|cts|mjs|cjs|jsx?)$/u;

const STYLE_FILE = /\.css$/u;

// oxlint-disable-next-line unicorn/no-useless-undefined, promise/prefer-await-to-then -- zod's catch takes the fallback positionally, and it is zod's catch, not a promise's
const versionMapSchema = z.record(z.string(), z.string()).optional().catch(undefined);

const manifestSchema = z.object({
  dependencies: versionMapSchema,
  devDependencies: versionMapSchema,
  name: z.string(),
  peerDependencies: versionMapSchema,
});

export type Manifest = z.infer<typeof manifestSchema>;

export interface Workspace {
  name: string;
  dir: string;
  manifest: Manifest;
}

const parseManifest = (file: string): Manifest => {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
  const manifest = manifestSchema.safeParse(value);
  if (!manifest.success) {
    throw new Error(`${file}: expected a package.json with a string "name"`);
  }
  return manifest.data;
};

export const readJsonFile = <T>(
  relativePath: string,
  schema: z.ZodType<T>,
  expected: string,
): T => {
  const parsed = schema.safeParse(
    JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8")),
  );
  if (!parsed.success) {
    throw new Error(`${relativePath}: expected ${expected}`);
  }
  return parsed.data;
};

const PNPM_LIST = ["ls", "--recursive", "--depth", "-1", "--json"];

const pnpmPackagesSchema = z.array(z.looseObject({ name: z.string(), path: z.string() }));

const listedPackageDirs = (): string[] => {
  const output = execFileSync("pnpm", PNPM_LIST, { cwd: REPO_ROOT, encoding: "utf-8" });
  try {
    return pnpmPackagesSchema.parse(JSON.parse(output)).map((listed) => listed.path);
  } catch (error) {
    throw new Error(
      `pnpm ${PNPM_LIST.join(" ")}: expected a JSON list of packages, each with a name and a path`,
      { cause: error },
    );
  }
};

let cachedWorkspaces: Workspace[] | undefined;

// pnpm's own answer, not a reading of its globs: a copy of its matching drifts from it, and the
// symptom is a green run over a smaller tree. pnpm reports real paths, and lists the root too.
export const workspaces = (): Workspace[] => {
  if (cachedWorkspaces !== undefined) {
    return cachedWorkspaces;
  }
  const root = fs.realpathSync(REPO_ROOT);
  cachedWorkspaces = listedPackageDirs()
    .map((dir) => fs.realpathSync(dir))
    .filter((dir) => dir !== root)
    .map((dir) => {
      const manifest = parseManifest(path.join(dir, "package.json"));
      return { dir: path.relative(root, dir), manifest, name: manifest.name };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return cachedWorkspaces;
};

// `apps/cli` → `apps`; workspace-coverage.test.ts holds every workspace one level under its group.
export const workspaceGroups = (): string[] =>
  [...new Set(workspaces().map((workspace) => path.dirname(workspace.dir)))].toSorted();

// membership by workspaces(), never by name prefix: `inteligir` breaks the @repo/ convention and is
// exactly the dependency a shipping surface installs.
export const manifestWorkspaceDeps = (manifest: Manifest): Set<string> => {
  const all = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  };
  const names = new Set(workspaces().map((workspace) => workspace.name));
  return new Set(Object.keys(all).filter((name) => names.has(name)));
};

const walk = (dir: string, matches: RegExp, out: string[]): void => {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) {
        continue;
      }
      walk(full, matches, out);
    } else if (matches.test(entry.name)) {
      out.push(path.relative(REPO_ROOT, full));
    }
  }
};

let cachedTracked: string[] | undefined;

// git's index, not a directory walk, for a guard judging what the repo commits: build output and
// ignored sidecars are not in it.
export const trackedFiles = (): string[] => {
  if (cachedTracked !== undefined) {
    return cachedTracked;
  }
  cachedTracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(
      (file) =>
        file.length > 0 &&
        // the index still lists a file deleted in the working tree.
        fs.existsSync(path.join(REPO_ROOT, file)),
    );
  return cachedTracked;
};

export const isTestFile = (relativePath: string): boolean =>
  /(?:^|\/)test-support\//u.test(relativePath) || /\.test\.[cm]?tsx?$/u.test(relativePath);

export interface WorkspaceFiles {
  shipped: string[];
  test: string[];
}

const cachedFiles = new Map<string, WorkspaceFiles>();

// shipped is `src/**` only: build scripts, configs and the editor's dev/ demo are not what a
// dependent gets.
export const workspaceFiles = (workspace: Workspace): WorkspaceFiles => {
  const cached = cachedFiles.get(workspace.name);
  if (cached !== undefined) {
    return cached;
  }
  const all: string[] = [];
  walk(path.join(REPO_ROOT, workspace.dir, "src"), SOURCE_FILE, all);
  const files: WorkspaceFiles = {
    shipped: all.filter((file) => !isTestFile(file)),
    test: all.filter((file) => isTestFile(file)),
  };
  cachedFiles.set(workspace.name, files);
  return files;
};

const cachedWorkspaceSources = new Map<string, string[]>();

// what the workspace holds rather than ships: a smoke script that hand-writes a route path drifts
// like a handler does, and lives nowhere near src/.
export const workspaceSourceFiles = (workspace: Workspace): string[] => {
  const cached = cachedWorkspaceSources.get(workspace.name);
  if (cached !== undefined) {
    return cached;
  }
  const found: string[] = [];
  walk(path.join(REPO_ROOT, workspace.dir), SOURCE_FILE, found);
  const sorted = found.toSorted();
  cachedWorkspaceSources.set(workspace.name, sorted);
  return sorted;
};

const cachedWorkspaceStyles = new Map<string, string[]>();

// the same walk and skip list as the source, or a build output answers for one half of a token
// pair.
export const styleFiles = (workspace: Workspace): string[] => {
  const cached = cachedWorkspaceStyles.get(workspace.name);
  if (cached !== undefined) {
    return cached;
  }
  const found: string[] = [];
  walk(path.join(REPO_ROOT, workspace.dir), STYLE_FILE, found);
  const sorted = found.toSorted();
  cachedWorkspaceStyles.set(workspace.name, sorted);
  return sorted;
};

const FULL_LINE_COMMENT = /^\s*(?:\/\/|\*|\/\*)/u;
const IMPORT_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["'](?<specifier>[^"'\n]+)["']/gu;

const cachedSources = new Map<string, string>();

// full-line comments dropped, so prose naming a package or a change kind cannot invent one; a
// trailing comment is left alone because stripping it safely means parsing the line, and eating
// real code fails open.
export const sourceOf = (relativePath: string): string => {
  const cached = cachedSources.get(relativePath);
  if (cached !== undefined) {
    return cached;
  }
  const source = fs
    .readFileSync(path.join(REPO_ROOT, relativePath), "utf-8")
    .split("\n")
    .filter((line) => !FULL_LINE_COMMENT.test(line))
    .join("\n");
  cachedSources.set(relativePath, source);
  return source;
};

export const importsOf = (relativePath: string): string[] => {
  const source = sourceOf(relativePath);
  const specifiers: string[] = [];
  IMPORT_SPECIFIER.lastIndex = 0;
  let match = IMPORT_SPECIFIER.exec(source);
  while (match !== null) {
    const found = match.groups?.specifier;
    if (found !== undefined) {
      specifiers.push(found);
    }
    match = IMPORT_SPECIFIER.exec(source);
  }
  return specifiers;
};

export const resolveWorkspace = (specifier: string): Workspace | null =>
  workspaces().find(
    (workspace) => specifier === workspace.name || specifier.startsWith(`${workspace.name}/`),
  ) ?? null;

const turboConfigSchema = z.looseObject({ tasks: z.record(z.string(), z.unknown()) });

// turbo.json is JSONC; sourceOf drops full-line comments, which is every comment this repo's turbo
// configs use. Each guard parses a body with its own task schema, since each reads other fields.
export const turboTaskBodies = (configPath: string): Map<string, unknown> => {
  const parsed = turboConfigSchema.safeParse(JSON.parse(sourceOf(configPath)));
  if (!parsed.success) {
    throw new Error(`${configPath}: expected an object at "tasks"`);
  }
  return new Map(Object.entries(parsed.data.tasks));
};

export const workspaceTurboConfig = (workspace: Workspace): string | null => {
  const relative = `${workspace.dir}/turbo.json`;
  return fs.existsSync(path.join(REPO_ROOT, relative)) ? relative : null;
};
