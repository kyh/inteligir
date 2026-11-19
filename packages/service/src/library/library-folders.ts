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

const heldFolders = async (scope: WriteScope) => {
  const { accountId, tx } = scope;
  const rows = await tx.select(FOLDER_COLUMNS).from(folder).where(eq(folder.accountId, accountId));
  const folders = new Map<string, FolderRow>(rows.map((row) => [row.id, row]));

  const reader: FolderReader = {
    children: (parentId) =>
      [...folders.values()].filter((row) => row.parentId === parentId && row.deletedAt === null),
    folder: (id) => folders.get(id) ?? null,
  };

  const store = async (row: Omit<FolderRow, "seq">) => {
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

export const writeFolders = async (scope: WriteScope, ops: readonly FolderOp[]) => {
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

  return [...landed.values()] satisfies FolderRow[];
};

export const folderOfTarget = async (scope: WriteScope, target: FolderTarget | undefined) => {
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
