import type { DbExecutor } from "@repo/db/drizzle-client";
import { changeSetFile, file, item, itemFile } from "@repo/db/library-schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";

import { anyOf, chunksOf } from "../library/set-sql";

const touch = async (tx: DbExecutor, accountId: string, shas: readonly string[], now: number) => {
  if (shas.length > 0) {
    await tx
      .update(file)
      .set({ touchedAt: now })
      .where(and(eq(file.accountId, accountId), anyOf(file.sha256, shas)));
  }
};

export const missingFiles = async (tx: DbExecutor, accountId: string, shas: readonly string[]) => {
  const unique = [...new Set(shas)];

  if (unique.length === 0) {
    return [] satisfies string[];
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
  readonly pathname: string;
}

const HELD_FILE = {
  bytes: file.bytes,
  createdAt: file.createdAt,
  mime: file.mime,
  pathname: file.pathname,
};

const fileIs = (accountId: string, sha: string) =>
  and(eq(file.accountId, accountId), eq(file.sha256, sha));

export const fileOf = async (tx: DbExecutor, accountId: string, sha: string) => {
  const [row] = await tx.select(HELD_FILE).from(file).where(fileIs(accountId, sha));

  return row ?? null;
};

export const touchFile = async (tx: DbExecutor, accountId: string, sha: string, now: number) => {
  const [row] = await tx
    .update(file)
    .set({ touchedAt: now })
    .where(fileIs(accountId, sha))
    .returning(HELD_FILE);

  return row ?? null;
};

export const servedNameOf = async (
  tx: DbExecutor,
  accountId: string,
  sha: string,
  asked: string | null,
) => {
  const rows = await tx
    .select({ name: item.originalName })
    .from(itemFile)
    .innerJoin(item, and(eq(item.accountId, itemFile.accountId), eq(item.id, itemFile.itemId)))
    .where(
      and(eq(itemFile.accountId, accountId), eq(itemFile.sha256, sha), eq(item.originalSha, sha)),
    )
    .orderBy(asc(item.savedAt), asc(item.id));

  const names = rows.map((row) => row.name).filter((name) => name !== null);

  return asked !== null && names.includes(asked) ? asked : (names[0] ?? null);
};

export const nameItemFiles = async (
  tx: DbExecutor,
  accountId: string,
  itemId: string,
  shas: readonly string[],
  now: number,
) => {
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

export const nameNewItemFiles = async (
  tx: DbExecutor,
  accountId: string,
  names: readonly { readonly itemId: string; readonly shas: readonly string[] }[],
  now: number,
) => {
  const rows = names.flatMap(({ itemId, shas }) =>
    [...new Set(shas)].map((sha256) => ({ accountId, itemId, sha256 })),
  );

  for (const chunk of chunksOf(rows, 1000)) {
    await tx.insert(itemFile).values(chunk);
  }

  await touch(tx, accountId, [...new Set(rows.map((row) => row.sha256))], now);
};

export const dropItemFiles = async (
  tx: DbExecutor,
  accountId: string,
  itemIds: readonly string[],
  now: number,
) => {
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

export const holdSetFiles = async (
  tx: DbExecutor,
  entry: { readonly accountId: string; readonly changeSetId: string; readonly itemId: string },
  shas: readonly string[],
  now: number,
) => {
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

export const releaseSetFiles = async (
  tx: DbExecutor,
  set: { readonly accountId: string; readonly changeSetId: string },
  itemIds: readonly string[],
  now: number,
) => {
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
