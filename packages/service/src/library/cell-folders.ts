// The library's folders, a tree of names under the contract's rules (`cell-rules.ts`), stored
// here: an item filed in a deleted folder lists as unsorted. A folder is no item, so its writes join
// no change set; each is stamped with the write's sequence number, as an item is.

import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import { folders } from "@repo/db/cell/schema";
import { FOLDER_NAME_MAX, folderPathNames } from "@repo/contract/library/library-wire";
import type { folderOpSchema } from "@repo/contract/library/library-wire";
import { folderOpLanding, folderOpRefusal } from "@repo/contract/library/cell-rules";
import type { FolderReader, FolderTarget } from "@repo/contract/library/cell-rules";
import { compareText, ordBetween } from "@repo/contract/library/order-key";
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

const readerOf = (db: CellDb): FolderReader => ({
  children: (parentId) => childrenOf(db, parentId),
  folder: (id) => readFolder(db, id),
});

// every op in order, each against the tree the ones before it left; any conflict lands none. The
// answer is each folder the write changed, as it left it
export const writeFolders = (scope: LandingScope, ops: readonly FolderOp[]): FolderRow[] => {
  const conflicts: ConflictCurrent[] = [];
  const landed = new Map<string, FolderRow>();
  const reader = readerOf(scope.storage.db);
  for (const op of ops) {
    const refusal = folderOpRefusal(reader, op);
    if (refusal === null) {
      for (const row of folderOpLanding(reader, op, scope.now)) {
        landed.set(row.id, storeFolder(scope, row));
      }
    } else if (refusal.kind === "not-found") {
      refuse(refusal);
    } else {
      conflicts.push({ current: refusal.current, id: refusal.id, kind: "folder" });
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
