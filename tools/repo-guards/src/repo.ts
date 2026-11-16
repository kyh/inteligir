import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const SOURCE_FILE = /\.(?:tsx?|mts|cts|mjs|cjs|jsx?)$/u;

export interface Workspace {
  readonly name: string;
  readonly dir: string;
}

export const readTextFile = (relativePath: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");

const pnpmPackagesSchema = z.array(z.looseObject({ name: z.string(), path: z.string() }));

let cachedWorkspaces: Workspace[] | undefined;

// pnpm's own answer, so a guard never walks a smaller tree than pnpm links
export const workspaces = (): Workspace[] => {
  if (cachedWorkspaces !== undefined) {
    return cachedWorkspaces;
  }
  const root = fs.realpathSync(REPO_ROOT);
  const output = execFileSync("pnpm", ["ls", "--recursive", "--depth", "-1", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  cachedWorkspaces = pnpmPackagesSchema
    .parse(JSON.parse(output))
    .map((listed) => ({
      dir: path.relative(root, fs.realpathSync(listed.path)),
      name: listed.name,
    }))
    .filter((workspace) => workspace.dir !== "")
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return cachedWorkspaces;
};

const walk = (dir: string, out: string[]): void => {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (SOURCE_FILE.test(entry.name)) {
      out.push(path.relative(REPO_ROOT, full));
    }
  }
};

const filesUnder = (dir: string): string[] => {
  const found: string[] = [];
  walk(path.join(REPO_ROOT, dir), found);
  return found.toSorted();
};

const isTestFile = (relativePath: string): boolean =>
  /(?:^|\/)test-support\//u.test(relativePath) || /\.test\.[cm]?tsx?$/u.test(relativePath);

export const shippedFiles = (workspace: Workspace): string[] =>
  filesUnder(path.join(workspace.dir, "src")).filter((file) => !isTestFile(file));

const FULL_LINE_COMMENT = /^\s*(?:\/\/|\*|\/\*)/u;

// full-line comments dropped, so prose cannot trip a guard
export const sourceOf = (relativePath: string): string =>
  readTextFile(relativePath)
    .split("\n")
    .filter((line) => !FULL_LINE_COMMENT.test(line))
    .join("\n");
