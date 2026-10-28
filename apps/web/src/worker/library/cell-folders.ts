// The library's folders: a tree of names, each guarded like a block by what its writer read (its
// name, its parent), and no two live siblings under one name, since an agent files by the path of
// names from the top. Deleting a folder deletes the folders under it; an item filed in a deleted
// folder lists as unsorted. A folder is no item, so its writes join no change set; each is stamped
// with the write's sequence number and logged, as every synced row is.

import type { folderOpSchema } from "@repo/contract/cloud/library/library-wire";
import { compareText, ordBetween } from "@repo/notes/library/block-order";
import { titleKey } from "@repo/notes/library/derive-item";
import { recordChanges } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import type { SqlRow, SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

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

const rowSchema = z.object({
  deleted_at: z.number().nullable(),
  id: z.string(),
  name: z.string(),
  parent_id: z.string().nullable(),
  seq: z.number(),
  sort: z.string(),
});

const COLUMNS = "id, parent_id, name, sort, deleted_at, seq";

const rowOf = (raw: SqlRow): FolderRow => {
  const row = rowSchema.parse(raw);
  return {
    deletedAt: row.deleted_at,
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    seq: row.seq,
    sort: row.sort,
  };
};

const readFolder = (sql: SqlStatements, id: string): FolderRow | null => {
  const [raw] = sql.all(`SELECT ${COLUMNS} FROM folders WHERE id = ?`, [id]);
  return raw === undefined ? null : rowOf(raw);
};

export const liveFolders = (sql: SqlStatements): FolderRow[] =>
  sql
    .all(`SELECT ${COLUMNS} FROM folders WHERE deleted_at IS NULL ORDER BY sort, id`, [])
    .map(rowOf);

const live = (row: FolderRow | null): FolderRow | null => (row?.deletedAt === null ? row : null);

const storeFolder = (scope: LandingScope, row: Omit<FolderRow, "seq">): void => {
  const seq = scope.seq();
  scope.storage.run(
    `INSERT INTO folders (id, parent_id, name, sort, deleted_at, seq) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name,
       sort = excluded.sort, deleted_at = excluded.deleted_at, seq = excluded.seq`,
    [row.id, row.parentId, row.name, row.sort, row.deletedAt, seq],
  );
  runPlan(scope.storage, recordChanges([{ gone: false, id: row.id, kind: "folder", seq }]));
};

const conflictOf = (id: string, current: FolderRow | null): ConflictCurrent => ({
  current,
  id,
  kind: "folder",
});

const childrenOf = (sql: SqlStatements, parentId: string | null): FolderRow[] =>
  sql
    .all(`SELECT ${COLUMNS} FROM folders WHERE parent_id IS ? AND deleted_at IS NULL`, [parentId])
    .map(rowOf);

// the live sibling another folder would share a name with
const namesake = (
  sql: SqlStatements,
  folder: { readonly id: string; readonly parentId: string | null; readonly name: string },
): FolderRow | null =>
  childrenOf(sql, folder.parentId).find(
    (sibling) => sibling.id !== folder.id && titleKey(sibling.name) === titleKey(folder.name),
  ) ?? null;

// whether `ancestor` is `folderId` or a folder above it
const isAtOrAbove = (sql: SqlStatements, ancestor: string, folderId: string | null): boolean => {
  const seen = new Set<string>();
  for (
    let at = folderId;
    at !== null && !seen.has(at);
    at = readFolder(sql, at)?.parentId ?? null
  ) {
    if (at === ancestor) {
      return true;
    }
    seen.add(at);
  }
  return false;
};

type Op<K extends FolderOp["op"]> = Extract<FolderOp, { op: K }>;

const liveParentOrRefuse = (sql: SqlStatements, parentId: string): FolderRow =>
  live(readFolder(sql, parentId)) ?? refuse({ kind: "not-found" });

const createConflict = (sql: SqlStatements, op: Op<"create">): ConflictCurrent | null => {
  const held = readFolder(sql, op.id);
  if (held !== null) {
    const same = held.deletedAt === null && held.name === op.name && held.parentId === op.parentId;
    return same ? null : conflictOf(op.id, held);
  }
  if (op.parentId !== null) {
    liveParentOrRefuse(sql, op.parentId);
  }
  const clash = namesake(sql, op);
  return clash === null ? null : conflictOf(clash.id, clash);
};

const renameConflict = (sql: SqlStatements, op: Op<"rename">): ConflictCurrent | null => {
  const held = readFolder(sql, op.id);
  const current = live(held);
  if (current === null || (current.name !== op.base && current.name !== op.name)) {
    return conflictOf(op.id, held);
  }
  const clash = namesake(sql, { ...current, name: op.name });
  return clash === null ? null : conflictOf(clash.id, clash);
};

const moveConflict = (sql: SqlStatements, op: Op<"move">): ConflictCurrent | null => {
  const held = readFolder(sql, op.id);
  const current = live(held);
  if (current === null || current.parentId !== op.baseParentId) {
    return current?.parentId === op.parentId ? null : conflictOf(op.id, held);
  }
  if (op.parentId !== null) {
    const parent = liveParentOrRefuse(sql, op.parentId);
    // a folder cannot go under itself: the tree the writer read did not hold it there
    if (isAtOrAbove(sql, op.id, op.parentId)) {
      return conflictOf(parent.id, parent);
    }
  }
  const clash = namesake(sql, { ...current, parentId: op.parentId });
  return clash === null ? null : conflictOf(clash.id, clash);
};

// what an op met instead of its base, or null when it may land (an op already true included)
const opConflict = (sql: SqlStatements, op: FolderOp): ConflictCurrent | null => {
  switch (op.op) {
    case "create": {
      return createConflict(sql, op);
    }
    case "rename": {
      return renameConflict(sql, op);
    }
    case "move": {
      return moveConflict(sql, op);
    }
    case "delete": {
      return null;
    }
    // no default
  }
};

// a folder and every live folder under it, deepest last
const subtreeOf = (sql: SqlStatements, root: FolderRow): FolderRow[] => {
  const found: FolderRow[] = [root];
  // an array's iterator reads the entries pushed while it runs, so each folder's children follow
  for (const parent of found) {
    found.push(...childrenOf(sql, parent.id));
  }
  return found;
};

const landOp = (scope: LandingScope, op: FolderOp): void => {
  const { storage } = scope;
  const held = readFolder(storage, op.id);
  switch (op.op) {
    case "create": {
      if (held === null) {
        storeFolder(scope, {
          deletedAt: null,
          id: op.id,
          name: op.name,
          parentId: op.parentId,
          sort: op.sort,
        });
      }
      break;
    }
    case "rename": {
      if (held !== null && held.name !== op.name) {
        storeFolder(scope, { ...held, name: op.name });
      }
      break;
    }
    case "move": {
      if (held !== null && (held.parentId !== op.parentId || held.sort !== op.sort)) {
        storeFolder(scope, { ...held, parentId: op.parentId, sort: op.sort });
      }
      break;
    }
    case "delete": {
      const current = live(held);
      if (current !== null) {
        for (const folder of subtreeOf(storage, current)) {
          storeFolder(scope, { ...folder, deletedAt: scope.now });
        }
      }
      break;
    }
    // no default
  }
};

// every op in order, each against the tree the ones before it left; any conflict lands none
export const writeFolders = (scope: LandingScope, ops: readonly FolderOp[]): void => {
  const conflicts: ConflictCurrent[] = [];
  for (const op of ops) {
    const conflict = opConflict(scope.storage, op);
    if (conflict === null) {
      landOp(scope, op);
    } else {
      conflicts.push(conflict);
    }
  }
  if (conflicts.length > 0) {
    refuse({ current: conflicts, kind: "conflict" });
  }
};

const PATH_SEPARATOR = "/";

// the folder a target names, the folders a path names made where they are missing; undefined
// when the target leaves the item where it is
export const folderOfTarget = (
  scope: LandingScope,
  target: FolderTarget | undefined,
  newId: () => string,
): string | null | undefined => {
  if (target === undefined || target === null) {
    return target;
  }
  if ("id" in target) {
    return live(readFolder(scope.storage, target.id)) === null
      ? refuse({ kind: "not-found" })
      : target.id;
  }
  let parentId: string | null = null;
  for (const name of target.path.split(PATH_SEPARATOR).map((segment) => segment.trim())) {
    if (name === "") {
      continue;
    }
    const siblings = childrenOf(scope.storage, parentId);
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
