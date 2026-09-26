import { isIgnoredEntryName, vaultFileQuerySchema } from "@repo/api/cloud/vault/vault-schema";
import type { VaultTreeResponse } from "@repo/api/cloud/vault/vault-schema";
import type { TreeResult } from "durable-git";

export type TreeFile = VaultTreeResponse["entries"][number];

// one directory's entries at the commit being walked; null when that revision does not carry it.
export type ListTree = (dir: string) => Promise<TreeResult | null>;

export type TreeWalkRefusal = "missing" | "too-many-dirs";

type TreeWalk = { ok: true; files: TreeFile[] } | { ok: false; refusal: TreeWalkRefusal };

interface WalkTreeArgs {
  listTree: ListTree;
  maxDirs: number;
  after?: string | undefined;
  // only the `keep` smallest paths survive, which lets the walk skip every directory past them.
  keep?: number | undefined;
}

// list only what the file route answers: git allows any byte but NUL and `/` in a name, and one
// pushed `a\b.md` would otherwise fail the phone's parse of the whole listing.
const servable = (path: string): boolean => vaultFileQuerySchema.safeParse({ path }).success;

const byPath = (a: TreeFile, b: TreeFile): number => {
  if (a.path < b.path) {
    return -1;
  }
  return a.path > b.path ? 1 : 0;
};

// every path under dir starts with dir + "/", and a string never sorts before its own prefix: a
// cursor past that prefix and not inside it is past the whole subtree, and a subtree whose prefix
// does not sort before the bound holds no path before it.
const subtreeReaches = (dir: string, after: string | undefined): boolean => {
  if (after === undefined) {
    return true;
  }
  const prefix = `${dir}/`;
  return after < prefix || after.startsWith(prefix);
};

const startingBefore = (dirs: string[], bound: string | undefined): string[] =>
  bound === undefined ? dirs : dirs.filter((dir) => `${dir}/` < bound);

interface ListedDir {
  dir: string;
  tree: TreeResult | null;
}

interface TreeLevel {
  dirs: string[];
  files: TreeFile[];
}

// the subdirectories still worth visiting, and the blobs past the cursor; null when a listing came
// back missing.
const readLevel = (listed: ListedDir[], after: string | undefined): TreeLevel | null => {
  const dirs: string[] = [];
  const files: TreeFile[] = [];
  for (const { dir, tree } of listed) {
    if (tree === null) {
      return null;
    }
    for (const entry of tree.entries) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (isIgnoredEntryName(entry.name) || !servable(path)) {
        continue;
      }
      if (entry.type === "tree") {
        if (subtreeReaches(path, after)) {
          dirs.push(path);
        }
      } else if (entry.type === "blob" && (after === undefined || path > after)) {
        files.push({ oid: entry.oid, path, size: entry.size ?? 0 });
      }
    }
  }
  return { dirs, files };
};

// breadth-first, one round of concurrent listings per level. Once `keep` paths are held, the
// largest of them is a bound no path past it can beat, so the frontier drops every directory that
// starts past it.
export const walkTree = async ({
  after,
  keep,
  listTree,
  maxDirs,
}: WalkTreeArgs): Promise<TreeWalk> => {
  let files: TreeFile[] = [];
  let frontier = [""];
  let bound: string | undefined;
  let visited = 0;
  while (frontier.length > 0) {
    visited += frontier.length;
    if (visited > maxDirs) {
      return { ok: false, refusal: "too-many-dirs" };
    }
    const listed = await Promise.all(
      frontier.map(async (dir) => ({ dir, tree: await listTree(dir) })),
    );
    const level = readLevel(listed, after);
    if (level === null) {
      return { ok: false, refusal: "missing" };
    }
    for (const file of level.files) {
      files.push(file);
    }
    if (keep !== undefined && files.length >= keep) {
      files.sort(byPath);
      files = files.slice(0, keep);
      bound = files.at(-1)?.path;
    }
    frontier = startingBefore(level.dirs, bound);
  }
  files.sort(byPath);
  return { files, ok: true };
};

// index of the first path past `after` in a listing sorted by path.
const firstPast = (sorted: readonly TreeFile[], after: string): number => {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const entry = sorted[middle];
    if (entry !== undefined && entry.path <= after) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

// `sorted` holds every servable path past `after`, or at least the limit + 1 smallest of them.
export const pageTree = (
  commit: string,
  sorted: readonly TreeFile[],
  after: string | undefined,
  limit: number,
): VaultTreeResponse => {
  const start = after === undefined ? 0 : firstPast(sorted, after);
  const window = sorted.slice(start, start + limit + 1);
  const entries = window.slice(0, limit);
  const last = entries.at(-1);
  return {
    commit,
    entries,
    next: window.length > entries.length && last !== undefined ? last.path : null,
  };
};
