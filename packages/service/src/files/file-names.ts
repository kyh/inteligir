// The files the library names, by sha: an item names its original, its cover and each file its
// body embeds (`item_file`), and a write may name only a file the library holds. Every name added
// or dropped moves its file's `touched_at`, so a file is let go a day after its last name went by
// asking the naming rows alone, never a count kept beside them.

import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { changeSetFile, file, itemFile } from "@repo/db/library-schema";
import { and, eq, inArray } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";

import { anyOf, chunksOf } from "../library/set-sql";

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
      .where(and(eq(file.accountId, accountId), anyOf(file.sha256, shas)));
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

export interface HeldFile {
  readonly bytes: number;
  readonly createdAt: number;
  readonly mime: string;
  // where the store keeps its bytes
  readonly pathname: string;
}

// a file the library holds, by its sha; null for one it does not
export const fileOf = async (
  tx: DbExecutor,
  accountId: string,
  sha: string,
): Promise<HeldFile | null> => {
  const [row] = await tx
    .select({
      bytes: file.bytes,
      createdAt: file.createdAt,
      mime: file.mime,
      pathname: file.pathname,
    })
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

// the files items the write makes name, each item's names written and every file named touched
export const nameNewItemFiles = async (
  tx: DbExecutor,
  accountId: string,
  names: readonly { readonly itemId: string; readonly shas: readonly string[] }[],
  now: number,
): Promise<void> => {
  const rows = names.flatMap(({ itemId, shas }) =>
    [...new Set(shas)].map((sha256) => ({ accountId, itemId, sha256 })),
  );
  for (const chunk of chunksOf(rows, 1000)) {
    await tx.insert(itemFile).values(chunk);
  }
  await touch(tx, accountId, [...new Set(rows.map((row) => row.sha256))], now);
};

// items about to go for good: every file they and their change sets name is touched, and the rows
// naming them go with the items' own
export const dropItemFiles = async (
  tx: DbExecutor,
  accountId: string,
  itemIds: readonly string[],
  now: number,
): Promise<void> => {
  await tx
    .update(file)
    .set({ touchedAt: now })
    .where(
      and(
        eq(file.accountId, accountId),
        inArray(
          file.sha256,
          union(
            tx
              .select({ sha256: itemFile.sha256 })
              .from(itemFile)
              .where(and(eq(itemFile.accountId, accountId), anyOf(itemFile.itemId, itemIds))),
            tx
              .select({ sha256: changeSetFile.sha256 })
              .from(changeSetFile)
              .where(
                and(eq(changeSetFile.accountId, accountId), anyOf(changeSetFile.itemId, itemIds)),
              ),
          ),
        ),
      ),
    );
};

// The files a change set's entry for an item would name again, held while the entry stands: each
// one added is touched. A hold only grows while the turn writes, so a file a later landing of the
// turn left out stays held until the entry goes
export const holdSetFiles = async (
  tx: DbExecutor,
  entry: { readonly accountId: string; readonly changeSetId: string; readonly itemId: string },
  shas: readonly string[],
  now: number,
): Promise<void> => {
  if (shas.length === 0) {
    return;
  }
  const { accountId, changeSetId, itemId } = entry;
  const added = await tx
    .insert(changeSetFile)
    .values([...new Set(shas)].map((sha256) => ({ accountId, changeSetId, itemId, sha256 })))
    .onConflictDoNothing()
    .returning({ sha256: changeSetFile.sha256 });
  await touch(
    tx,
    accountId,
    added.map((row) => row.sha256),
    now,
  );
};

// a set's entries for these items about to go: each file they held is let go, and touched
export const releaseSetFiles = async (
  tx: DbExecutor,
  set: { readonly accountId: string; readonly changeSetId: string },
  itemIds: readonly string[],
  now: number,
): Promise<void> => {
  const { accountId, changeSetId } = set;
  const dropped = await tx
    .delete(changeSetFile)
    .where(
      and(
        eq(changeSetFile.accountId, accountId),
        eq(changeSetFile.changeSetId, changeSetId),
        anyOf(changeSetFile.itemId, itemIds),
      ),
    )
    .returning({ sha256: changeSetFile.sha256 });
  await touch(tx, accountId, [...new Set(dropped.map((row) => row.sha256))], now);
};
