// The files the library names, by sha: an item names its original, its cover and each file its
// body embeds (`item_file`), and a write may name only a file the library holds. Every name added
// or dropped moves its file's `touched_at`, so a file is let go a day after its last name went by
// asking the naming rows alone, never a count kept beside them.

import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { changeSetFile, file, itemFile } from "@repo/db/library-schema";
import { and, eq, inArray } from "drizzle-orm";

const fieldFilesOf = ({ coverSha, originalSha }: LibraryItemFields): string[] =>
  [originalSha, coverSha].filter((sha) => sha !== null);

// every file an item names: its original and cover by field, and each image, video or file its
// body embeds, as its digest last read the body
export const itemFilesOf = (fields: LibraryItemFields, bodyFiles: readonly string[]): string[] => [
  ...new Set([...fieldFilesOf(fields), ...bodyFiles]),
];

const touch = async (
  tx: DbExecutor,
  accountId: string,
  shas: readonly string[],
  now: number,
): Promise<void> => {
  if (shas.length > 0) {
    await tx
      .update(file)
      .set({ touchedAt: now })
      .where(and(eq(file.accountId, accountId), inArray(file.sha256, [...shas])));
  }
};

// of `shas`, those the library holds no file for, in sha order
export const missingFiles = async (
  tx: DbExecutor,
  accountId: string,
  shas: readonly string[],
): Promise<string[]> => {
  const unique = [...new Set(shas)];
  if (unique.length === 0) {
    return [];
  }
  const held = await tx
    .select({ sha256: file.sha256 })
    .from(file)
    .where(and(eq(file.accountId, accountId), inArray(file.sha256, unique)));
  const known = new Set(held.map((row) => row.sha256));
  return unique.filter((sha) => !known.has(sha)).toSorted();
};

// a file the library holds, by its sha; null for one it does not
export const fileOf = async (
  tx: DbExecutor,
  accountId: string,
  sha: string,
): Promise<{ readonly bytes: number; readonly mime: string } | null> => {
  const [row] = await tx
    .select({ bytes: file.bytes, mime: file.mime })
    .from(file)
    .where(and(eq(file.accountId, accountId), eq(file.sha256, sha)));
  return row ?? null;
};

// the files an item names now, in place of those it named; each file whose name came or went is
// touched
export const nameItemFiles = async (
  tx: DbExecutor,
  accountId: string,
  itemId: string,
  shas: readonly string[],
  now: number,
): Promise<void> => {
  const named = await tx
    .select({ sha256: itemFile.sha256 })
    .from(itemFile)
    .where(and(eq(itemFile.accountId, accountId), eq(itemFile.itemId, itemId)));
  const before = new Set(named.map((row) => row.sha256));
  const after = new Set(shas);
  const dropped = [...before].filter((sha) => !after.has(sha));
  const added = [...after].filter((sha) => !before.has(sha));
  if (dropped.length > 0) {
    await tx
      .delete(itemFile)
      .where(
        and(
          eq(itemFile.accountId, accountId),
          eq(itemFile.itemId, itemId),
          inArray(itemFile.sha256, dropped),
        ),
      );
  }
  if (added.length > 0) {
    await tx.insert(itemFile).values(added.map((sha256) => ({ accountId, itemId, sha256 })));
  }
  await touch(tx, accountId, [...dropped, ...added], now);
};

// an item about to go for good: every file it and its change sets name is touched, and the rows
// naming them go with the item's own
export const dropItemFiles = async (
  tx: DbExecutor,
  accountId: string,
  itemId: string,
  now: number,
): Promise<void> => {
  const [byItem, bySets] = await Promise.all([
    tx
      .select({ sha256: itemFile.sha256 })
      .from(itemFile)
      .where(and(eq(itemFile.accountId, accountId), eq(itemFile.itemId, itemId))),
    tx
      .select({ sha256: changeSetFile.sha256 })
      .from(changeSetFile)
      .where(and(eq(changeSetFile.accountId, accountId), eq(changeSetFile.itemId, itemId))),
  ]);
  await touch(tx, accountId, [...new Set([...byItem, ...bySets].map((row) => row.sha256))], now);
};
