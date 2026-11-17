// The library's folders, a tree of names under the contract's rules
// (`@repo/contract/library/cell-rules`), stored here: an item filed in a deleted folder lists as
// unsorted. A folder is no item, so its writes join no change set; each is stamped with the write's
// sequence number, as an item is. A write reads the account's folders once and lands its ops on
// them in turn, each against the tree the ones before it left.

import { folderOpLanding, folderOpRefusal } from "@repo/contract/library/cell-rules";
import type { FolderReader, FolderTarget } from "@repo/contract/library/cell-rules";
import { titleKey } from "@repo/contract/library/derive-item";
import { FOLDER_NAME_MAX, folderPathNames } from "@repo/contract/library/library-wire";
import type { folderOpSchema, folderRowSchema } from "@repo/contract/library/library-wire";
import { compareText, ordBetween } from "@repo/contract/library/order-key";
import { folder } from "@repo/db/library-schema";
import { eq } from "drizzle-orm";
import type { z } from "zod";

import { mintLibraryId } from "./library-ids";
import { refuse } from "./library-refusal";
import type { WriteScope } from "./library-store";

type FolderOp = z.infer<typeof folderOpSchema>;
type FolderRow = z.infer<typeof folderRowSchema>;

const FOLDER_COLUMNS = {
  deletedAt: folder.deletedAt,
  id: folder.id,
  name: folder.name,
  parentId: folder.parentId,
  seq: folder.seq,
  sort: folder.sort,
};

// the account's folders as a write holds them, live and deleted, each one it lands put back in
const heldFolders = async (scope: WriteScope) => {
  const { accountId, tx } = scope;
  const rows = await tx.select(FOLDER_COLUMNS).from(folder).where(eq(folder.accountId, accountId));
  const folders = new Map<string, FolderRow>(rows.map((row) => [row.id, row]));
  const reader: FolderReader = {
    children: (parentId) =>
      [...folders.values()].filter((row) => row.parentId === parentId && row.deletedAt === null),
    folder: (id) => folders.get(id) ?? null,
  };
  const store = async (row: Omit<FolderRow, "seq">): Promise<FolderRow> => {
    const landed: FolderRow = { ...row, seq: await scope.seq() };
    const { deletedAt, name, parentId, seq, sort } = landed;
    await tx
      .insert(folder)
      .values({ ...landed, accountId })
      .onConflictDoUpdate({
        set: { deletedAt, name, parentId, seq, sort },
        target: [folder.accountId, folder.id],
      });
    folders.set(landed.id, landed);
    return landed;
  };
  return { reader, store };
};

// every op in order; one refusal lands none. The answer is each folder the write changed, as it
// left it
export const writeFolders = async (
  scope: WriteScope,
  ops: readonly FolderOp[],
): Promise<FolderRow[]> => {
  const { reader, store } = await heldFolders(scope);
  const landed = new Map<string, FolderRow>();
  for (const op of ops) {
    const refusal = folderOpRefusal(reader, op);
    if (refusal !== null) {
      refuse({ kind: refusal });
    }
    for (const row of folderOpLanding(reader, op, scope.now)) {
      landed.set(row.id, await store(row));
    }
  }
  return [...landed.values()];
};

// the folder a target names, the folders a path names made where they are missing, each name cut
// to what a folder holds, since an import's paths come from a file and the contract read none of
// them; undefined when the target leaves the item where it is
export const folderOfTarget = async (
  scope: WriteScope,
  target: FolderTarget | undefined,
): Promise<string | null | undefined> => {
  if (target === undefined || target === null) {
    return target;
  }
  const { reader, store } = await heldFolders(scope);
  if ("id" in target) {
    return reader.folder(target.id)?.deletedAt === null ? target.id : refuse({ kind: "not-found" });
  }
  let parentId: string | null = null;
  for (const written of folderPathNames(target.path)) {
    const name = written.slice(0, FOLDER_NAME_MAX).trim();
    const siblings = reader.children(parentId);
    const held = siblings.find((sibling) => titleKey(sibling.name) === titleKey(name));
    if (held === undefined) {
      const last =
        siblings
          .map((sibling) => sibling.sort)
          .toSorted(compareText)
          .at(-1) ?? null;
      const made = await store({
        deletedAt: null,
        id: mintLibraryId(scope.now),
        name,
        parentId,
        sort: ordBetween(last, null),
      });
      parentId = made.id;
    } else {
      parentId = held.id;
    }
  }
  return parentId;
};
