import type { TreeEntryJson } from "durable-git";
import { describe, expect, it } from "vitest";
import { pageTree, walkTree } from "../vault/tree-walk";
import type { ListTree, TreeFile } from "../vault/tree-walk";

const COMMIT = "c".repeat(40);
const OID = "0".repeat(40);
const MAX_DIRS = 10_000;

const byCodeUnit = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
};

interface FakeVault {
  listTree: ListTree;
  visits: () => number;
}

// a vault given as its file paths; every listing counts, because each one is a cell rpc.
const fakeVault = (paths: readonly string[], missing?: string): FakeVault => {
  const trees = new Map<string, TreeEntryJson[]>();
  for (const path of paths) {
    const segments = path.split("/");
    for (const [depth, name] of segments.entries()) {
      const dir = segments.slice(0, depth).join("/");
      const entries = trees.get(dir) ?? [];
      trees.set(dir, entries);
      if (entries.some((entry) => entry.name === name)) {
        continue;
      }
      entries.push(
        depth === segments.length - 1
          ? { mode: "100644", name, oid: OID, size: path.length, type: "blob" }
          : { mode: "40000", name, oid: OID, type: "tree" },
      );
    }
  }
  let visits = 0;
  return {
    listTree: async (dir) => {
      visits += 1;
      const entries = trees.get(dir);
      return dir === missing || entries === undefined ? null : { entries, oid: OID };
    },
    visits: () => visits,
  };
};

const pad = (n: number): string => String(n).padStart(2, "0");

// thirty folders, each holding notes of its own beside ten subfolders, each of those holding
// notes beside three more: 1,231 directories, the shape a many-folder vault has.
const WIDE: string[] = ["index.md"];
for (let folder = 0; folder < 30; folder += 1) {
  for (let note = 0; note < 3; note += 1) {
    WIDE.push(`f${pad(folder)}/n${note}.md`);
  }
  for (let sub = 0; sub < 10; sub += 1) {
    for (let note = 0; note < 2; note += 1) {
      WIDE.push(`f${pad(folder)}/s${sub}/m${note}.md`);
    }
    for (let leaf = 0; leaf < 3; leaf += 1) {
      WIDE.push(`f${pad(folder)}/s${sub}/t${leaf}/leaf.md`);
    }
  }
}

const everyPathPast = (after?: string): string[] =>
  WIDE.filter((path) => after === undefined || path > after).toSorted(byCodeUnit);

const pathsOf = (files: readonly TreeFile[]): string[] => files.map((file) => file.path);

interface Bounds {
  after?: string | undefined;
  keep?: number | undefined;
}

const walkedPaths = async (vault: FakeVault, { after, keep }: Bounds = {}): Promise<string[]> => {
  const walk = await walkTree({ after, keep, listTree: vault.listTree, maxDirs: MAX_DIRS });
  if (!walk.ok) {
    throw new Error(`the walk refused: ${walk.refusal}`);
  }
  return pathsOf(walk.files);
};

// every page pinned to one commit, as the phone pages; unbounded, each walk keeps every path.
const pageWhole = async (
  limit: number,
  bounded: boolean,
): Promise<{ paths: string[]; visits: number }> => {
  const vault = fakeVault(WIDE);
  const paths: string[] = [];
  let after: string | undefined;
  do {
    const walk = await walkTree({
      after,
      keep: bounded ? limit + 1 : undefined,
      listTree: vault.listTree,
      maxDirs: MAX_DIRS,
    });
    if (!walk.ok) {
      throw new Error(`the walk refused: ${walk.refusal}`);
    }
    const page = pageTree(COMMIT, walk.files, after, limit);
    paths.push(...pathsOf(page.entries));
    after = page.next ?? undefined;
  } while (after !== undefined);
  return { paths, visits: vault.visits() };
};

describe("the hosted tree walk", () => {
  it("keeps exactly the smallest paths past the cursor that the unbounded walk finds", async () => {
    const cursors = [undefined, "f05", "f05/s3", "f05/s3/", "f12/n2.md", "f29/s9/t2/leaf.md", "z"];
    for (const [index, path] of WIDE.entries()) {
      if (index % 97 === 0) {
        cursors.push(path);
      }
    }
    for (const after of cursors) {
      for (const keep of [1, 2, 11, 101]) {
        const vault = fakeVault(WIDE);
        expect(await walkedPaths(vault, { after, keep })).toEqual(
          everyPathPast(after).slice(0, keep),
        );
      }
    }
  });

  it("lists far fewer directories for a page than the unbounded walk", async () => {
    const unbounded = fakeVault(WIDE);
    const bounded = fakeVault(WIDE);
    const everyPath = await walkedPaths(unbounded);
    expect(await walkedPaths(bounded, { keep: 11 })).toEqual(everyPath.slice(0, 11));
    expect(unbounded.visits()).toBe(1231);
    expect(bounded.visits()).toBeLessThan(unbounded.visits() / 10);
  });

  it("pages the whole vault identically with far fewer listings", async () => {
    const unbounded = await pageWhole(10, false);
    const bounded = await pageWhole(10, true);
    expect(bounded.paths).toEqual(everyPathPast());
    expect(unbounded.paths).toEqual(bounded.paths);
    expect(bounded.visits).toBeLessThan(unbounded.visits / 5);
  });

  it("refuses a walk past the directory ceiling", async () => {
    const vault = fakeVault(WIDE);
    expect(await walkTree({ listTree: vault.listTree, maxDirs: 30 })).toEqual({
      ok: false,
      refusal: "too-many-dirs",
    });
  });

  it("refuses a walk whose revision no longer carries a listed directory", async () => {
    const vault = fakeVault(WIDE, "f03/s4");
    expect(await walkTree({ listTree: vault.listTree, maxDirs: MAX_DIRS })).toEqual({
      ok: false,
      refusal: "missing",
    });
  });

  it("skips git's machinery and every name the contract's grammar refuses", async () => {
    const vault = fakeVault(["a.md", ".git/config", "a\\b.md", "2024\\q1/c.md", "d/e.md"]);
    expect(await walkedPaths(vault)).toEqual(["a.md", "d/e.md"]);
  });
});

describe("a tree page", () => {
  const LISTING: TreeFile[] = ["a.md", "b/c.md", "b/d.md", "e.md"].map((path) => ({
    path,
    size: 1,
  }));

  it("starts past the cursor whether or not the cursor names a listed path", () => {
    expect(pathsOf(pageTree(COMMIT, LISTING, "b/c.md", 1).entries)).toEqual(["b/d.md"]);
    expect(pathsOf(pageTree(COMMIT, LISTING, "b", 1).entries)).toEqual(["b/c.md"]);
    expect(pathsOf(pageTree(COMMIT, LISTING, "0", 1).entries)).toEqual(["a.md"]);
  });

  it("names the next cursor only while a path remains", () => {
    expect(pageTree(COMMIT, LISTING, undefined, 3)).toEqual({
      commit: COMMIT,
      entries: LISTING.slice(0, 3),
      next: "b/d.md",
    });
    expect(pageTree(COMMIT, LISTING, "b/c.md", 2).next).toBeNull();
    expect(pageTree(COMMIT, LISTING, "e.md", 2)).toEqual({
      commit: COMMIT,
      entries: [],
      next: null,
    });
  });
});
