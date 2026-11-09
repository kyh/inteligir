// The library's folders: a tree of names, each guarded like a block by what its writer read (its
// name, its parent), and no two live siblings under one name, since an agent files by the path of
// names from the top. Deleting a folder deletes the folders under it; an item filed in a deleted
// folder lists as unsorted. A folder is no item, so its writes join no change set; each is stamped
// with the write's sequence number, as an item is.

import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import { folders } from "@repo/db/cell/schema";
import { FOLDER_NAME_MAX, folderPathNames } from "@repo/contract/library/library-wire";
import type { folderOpSchema } from "@repo/contract/library/library-wire";
import { compareText, ordBetween } from "@repo/contract/library/block-order";
import { titleKey } from "@repo/contract/library/derive-item";

import { excluded } from "./cell-db";
import type { CellDb } from "./cell-db";
import type { LandingScope } from "./cell-landing";
import { refuse } from "./cell-refusal";
import type { ConflictCurrent } from "./cell-refusal";

type FolderOp = z.infer<typeof folderOpSchema>;

export interface FolderRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly sort: string;
  readonly deletedAt: number | null;
  readonly seq: number;
}

// where an item is filed: a folder by id, by its path of names from the top, or none
export type FolderTarget = { readonly id: string } | { readonly path: string } | null;

const readFolder = (db: CellDb, id: string): FolderRow | null =>
  db.select().from(folders).where(eq(folders.id, id)).get() ?? null;

export const liveFolders = (db: CellDb): FolderRow[] =>
  db
    .select()
    .from(folders)
    .where(isNull(folders.deletedAt))
    .orderBy(asc(folders.sort), asc(folders.id))
    .all();

const live = (row: FolderRow | null): FolderRow | null => (row?.deletedAt === null ? row : null);

const storeFolder = (scope: LandingScope, row: Omit<FolderRow, "seq">): FolderRow => {
  const folder = { ...row, seq: scope.seq() };
  scope.storage.db
    .insert(folders)
    .values(folder)
    .onConflictDoUpdate({
      set: {
        deletedAt: excluded(folders.deletedAt),
        name: excluded(folders.name),
        parentId: excluded(folders.parentId),
        seq: excluded(folders.seq),
        sort: excluded(folders.sort),
      },
      target: folders.id,
    })
    .run();
  scope.moved.folder();
  return folder;
};

const conflictOf = (id: string, current: FolderRow | null): ConflictCurrent => ({
  current,
  id,
  kind: "folder",
});

const childrenOf = (db: CellDb, parentId: string | null): FolderRow[] =>
  db
    .select()
    .from(folders)
    .where(
      and(
        parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId),
        isNull(folders.deletedAt),
      ),
    )
    .all();

// the live sibling another folder would share a name with
const namesake = (
  db: CellDb,
  folder: { readonly id: string; readonly parentId: string | null; readonly name: string },
): FolderRow | null =>
  childrenOf(db, folder.parentId).find(
    (sibling) => sibling.id !== folder.id && titleKey(sibling.name) === titleKey(folder.name),
  ) ?? null;

// whether `ancestor` is `folderId` or a folder above it
const isAtOrAbove = (db: CellDb, ancestor: string, folderId: string | null): boolean => {
  const seen = new Set<string>();
  for (let at = folderId; at !== null && !seen.has(at); at = readFolder(db, at)?.parentId ?? null) {
    if (at === ancestor) {
      return true;
    }
    seen.add(at);
  }
  return false;
};

type Op<K extends FolderOp["op"]> = Extract<FolderOp, { op: K }>;

const liveParentOrRefuse = (db: CellDb, parentId: string): FolderRow =>
  live(readFolder(db, parentId)) ?? refuse({ kind: "not-found" });

const createConflict = (db: CellDb, op: Op<"create">): ConflictCurrent | null => {
  const held = readFolder(db, op.id);
  if (held !== null) {
    const same = held.deletedAt === null && held.name === op.name && held.parentId === op.parentId;
    return same ? null : conflictOf(op.id, held);
  }
  if (op.parentId !== null) {
    liveParentOrRefuse(db, op.parentId);
  }
  const clash = namesake(db, op);
  return clash === null ? null : conflictOf(clash.id, clash);
};

const renameConflict = (db: CellDb, op: Op<"rename">): ConflictCurrent | null => {
  const held = readFolder(db, op.id);
  const current = live(held);
  if (current === null || (current.name !== op.base && current.name !== op.name)) {
    return conflictOf(op.id, held);
  }
  const clash = namesake(db, { ...current, name: op.name });
  return clash === null ? null : conflictOf(clash.id, clash);
};

const moveConflict = (db: CellDb, op: Op<"move">): ConflictCurrent | null => {
  const held = readFolder(db, op.id);
  const current = live(held);
  if (current === null || current.parentId !== op.baseParentId) {
    return current?.parentId === op.parentId ? null : conflictOf(op.id, held);
  }
  if (op.parentId !== null) {
    const parent = liveParentOrRefuse(db, op.parentId);
    // a folder cannot go under itself: the tree the writer read did not hold it there
    if (isAtOrAbove(db, op.id, op.parentId)) {
      return conflictOf(parent.id, parent);
    }
  }
  const clash = namesake(db, { ...current, parentId: op.parentId });
  return clash === null ? null : conflictOf(clash.id, clash);
};

// what an op met instead of its base, or null when it may land (an op already true included)
const opConflict = (db: CellDb, op: FolderOp): ConflictCurrent | null => {
  switch (op.op) {
    case "create": {
      return createConflict(db, op);
    }
    case "rename": {
      return renameConflict(db, op);
    }
    case "move": {
      return moveConflict(db, op);
    }
    case "delete": {
      return null;
    }
    // no default
  }
};

// a folder and every live folder under it, deepest last
const subtreeOf = (db: CellDb, root: FolderRow): FolderRow[] => {
  const found: FolderRow[] = [root];
  // an array's iterator reads the entries pushed while it runs, so each folder's children follow
  for (const parent of found) {
    found.push(...childrenOf(db, parent.id));
  }
  return found;
};

// the rows the op changed, none for an op already true
const landOp = (scope: LandingScope, op: FolderOp): FolderRow[] => {
  const { db } = scope.storage;
  const held = readFolder(db, op.id);
  switch (op.op) {
    case "create": {
      return held === null
        ? [
            storeFolder(scope, {
              deletedAt: null,
              id: op.id,
              name: op.name,
              parentId: op.parentId,
              sort: op.sort,
            }),
          ]
        : [];
    }
    case "rename": {
      return held !== null && held.name !== op.name
        ? [storeFolder(scope, { ...held, name: op.name })]
        : [];
    }
    case "move": {
      return held !== null && (held.parentId !== op.parentId || held.sort !== op.sort)
        ? [storeFolder(scope, { ...held, parentId: op.parentId, sort: op.sort })]
        : [];
    }
    case "delete": {
      const current = live(held);
      return current === null
        ? []
        : subtreeOf(db, current).map((folder) =>
            storeFolder(scope, { ...folder, deletedAt: scope.now }),
          );
    }
    // no default
  }
};

// every op in order, each against the tree the ones before it left; any conflict lands none. The
// answer is each folder the write changed, as it left it
export const writeFolders = (scope: LandingScope, ops: readonly FolderOp[]): FolderRow[] => {
  const conflicts: ConflictCurrent[] = [];
  const landed = new Map<string, FolderRow>();
  for (const op of ops) {
    const conflict = opConflict(scope.storage.db, op);
    if (conflict === null) {
      for (const row of landOp(scope, op)) {
        landed.set(row.id, row);
      }
    } else {
      conflicts.push(conflict);
    }
  }
  if (conflicts.length > 0) {
    refuse({ current: conflicts, kind: "conflict" });
  }
  return [...landed.values()];
};

// the folder a target names, the folders a path names made where they are missing, each name cut
// to what a folder holds, since an import's paths come from a file and the contract read none of
// them; undefined when the target leaves the item where it is
export const folderOfTarget = (
  scope: LandingScope,
  target: FolderTarget | undefined,
  newId: () => string,
): string | null | undefined => {
  if (target === undefined || target === null) {
    return target;
  }
  const { db } = scope.storage;
  if ("id" in target) {
    return live(readFolder(db, target.id)) === null ? refuse({ kind: "not-found" }) : target.id;
  }
  let parentId: string | null = null;
  for (const written of folderPathNames(target.path)) {
    const name = written.slice(0, FOLDER_NAME_MAX).trim();
    const siblings = childrenOf(db, parentId);
    const held = siblings.find((sibling) => titleKey(sibling.name) === titleKey(name));
    if (held === undefined) {
      const last =
        siblings
          .map((sibling) => sibling.sort)
          .toSorted(compareText)
          .at(-1) ?? null;
      const id = newId();
      storeFolder(scope, { deletedAt: null, id, name, parentId, sort: ordBetween(last, null) });
      parentId = id;
    } else {
      parentId = held.id;
    }
  }
  return parentId;
};
