import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import { agentThread } from "@repo/db/agent-schema";
import { changeSet, changeSetBody, changeSetItem, itemBody } from "@repo/db/library-schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { holdSetFiles, releaseSetFiles } from "./file-names";
import { inverseOpSchema } from "./inverse-ops";
import type { InverseOp } from "./inverse-ops";
import type { WriteScope } from "./library-store";
import { nextEntry } from "./revert-change";
import type { SetEntry } from "./revert-change";
import { anyOf } from "./set-sql";

const entryRowSchema = z.union([
  z
    .object({ inverse: z.null(), made: libraryItemFieldsSchema })
    .transform(({ made }) => ({ fields: made, kind: "made" }) satisfies SetEntry),
  z
    .object({ inverse: z.array(inverseOpSchema), made: z.null() })
    .transform(({ inverse }) => ({ inverse, kind: "changed" }) satisfies SetEntry),
]);

export const ENTRY_COLUMNS = {
  inverse: changeSetItem.inverse,
  itemId: changeSetItem.itemId,
  made: changeSetItem.made,
};

export const entryOf = (row: { readonly inverse: unknown; readonly made: unknown }) =>
  entryRowSchema.parse(row);

const rowOf = (entry: SetEntry) =>
  entry.kind === "made"
    ? { inverse: null, made: entry.fields }
    : { inverse: [...entry.inverse], made: null };

const opFilesOf = (ops: readonly InverseOp[]) =>
  ops.flatMap((op) =>
    op.op === "set" &&
    (op.field === "originalSha" || op.field === "editedSha" || op.field === "coverSha") &&
    op.value !== null
      ? [op.value]
      : [],
  );

export const recordLanding = async (
  scope: WriteScope,
  setId: string,
  landing: {
    readonly itemId: string;
    readonly before: LibraryItemFields | null;
    readonly after: LibraryItemFields;
    readonly bodyFiles: readonly string[];
  },
) => {
  const { accountId, now, tx } = scope;
  const { after, before, bodyFiles, itemId } = landing;

  const [row] = await tx
    .select(ENTRY_COLUMNS)
    .from(changeSetItem)
    .where(
      and(
        eq(changeSetItem.accountId, accountId),
        eq(changeSetItem.changeSetId, setId),
        eq(changeSetItem.itemId, itemId),
      ),
    );

  const entry = nextEntry(row === undefined ? null : entryOf(row), before, after);
  await tx
    .insert(changeSetItem)
    .values({ accountId, changeSetId: setId, itemId, ...rowOf(entry) })
    .onConflictDoUpdate({
      set: rowOf(entry),
      target: [changeSetItem.accountId, changeSetItem.changeSetId, changeSetItem.itemId],
    });
  const files = [...(entry.kind === "changed" ? opFilesOf(entry.inverse) : []), ...bodyFiles];
  await holdSetFiles(tx, { accountId, changeSetId: setId, itemId }, files, now);
};

export const recordBody = async (
  scope: WriteScope,
  setId: string,
  body: { readonly itemId: string; readonly made: boolean; readonly versionAfter: number },
) => {
  const { accountId, tx } = scope;
  const { itemId, made, versionAfter } = body;

  const keep = {
    set: { versionAfter },
    target: [changeSetBody.accountId, changeSetBody.changeSetId, changeSetBody.itemId],
  };

  if (made) {
    await tx
      .insert(changeSetBody)
      .values({
        accountId,
        blocksBefore: [],
        changeSetId: setId,
        itemId,
        versionAfter,
        versionBefore: 0,
      })
      .onConflictDoUpdate(keep);

    return;
  }

  await tx
    .insert(changeSetBody)
    .select(
      tx
        .select({
          accountId: itemBody.accountId,
          blocksBefore: itemBody.blocks,
          changeSetId: sql<string>`${setId}`.as("change_set_id"),
          itemId: itemBody.itemId,
          versionAfter: sql<number>`${versionAfter}::int`.as("version_after"),
          versionBefore: itemBody.version,
        })
        .from(itemBody)
        .where(and(eq(itemBody.accountId, accountId), eq(itemBody.itemId, itemId))),
    )
    .onConflictDoUpdate(keep);
};

export const foldReading = async (
  scope: WriteScope,
  reading: {
    readonly itemId: string;
    readonly before: LibraryItemFields;
    readonly after: LibraryItemFields;
    readonly versionBefore: number;
    readonly versionAfter: number;
  },
) => {
  const { accountId, tx } = scope;
  const { after, before, itemId, versionAfter, versionBefore } = reading;

  const folded = await tx
    .update(changeSetItem)
    .set({ made: after })
    .where(
      and(
        eq(changeSetItem.accountId, accountId),
        eq(changeSetItem.itemId, itemId),
        eq(changeSetItem.made, before),
      ),
    )
    .returning({ changeSetId: changeSetItem.changeSetId });

  if (folded.length === 0 || versionAfter === versionBefore) {
    return;
  }

  await tx
    .update(changeSetBody)
    .set({ versionAfter })
    .where(
      and(
        eq(changeSetBody.accountId, accountId),
        eq(changeSetBody.itemId, itemId),
        eq(changeSetBody.versionAfter, versionBefore),
        anyOf(
          changeSetBody.changeSetId,
          folded.map(({ changeSetId }) => changeSetId),
        ),
      ),
    );
};

export const stampEntryThreads = async (
  scope: WriteScope,
  itemIds: readonly string[],
  seq: number,
) => {
  const { accountId, tx } = scope;
  await tx
    .update(agentThread)
    .set({ seq })
    .where(
      and(
        eq(agentThread.accountId, accountId),
        isNull(agentThread.deletedAt),
        inArray(
          agentThread.id,
          tx
            .selectDistinct({ id: changeSet.threadId })
            .from(changeSet)
            .innerJoin(
              changeSetItem,
              and(
                eq(changeSetItem.accountId, changeSet.accountId),
                eq(changeSetItem.changeSetId, changeSet.id),
              ),
            )
            .where(and(eq(changeSet.accountId, accountId), anyOf(changeSetItem.itemId, itemIds))),
        ),
      ),
    );
};

export const dropEntries = async (
  scope: WriteScope,
  entries: readonly { readonly changeSetId: string; readonly itemIds: readonly string[] }[],
) => {
  const { accountId, now, tx } = scope;

  for (const { changeSetId, itemIds } of entries) {
    if (itemIds.length > 0) {
      await releaseSetFiles(tx, { accountId, changeSetId }, itemIds, now);

      const entryIs = (table: typeof changeSetItem | typeof changeSetBody) =>
        and(
          eq(table.accountId, accountId),
          eq(table.changeSetId, changeSetId),
          anyOf(table.itemId, itemIds),
        );

      await tx.delete(changeSetItem).where(entryIs(changeSetItem));
      await tx.delete(changeSetBody).where(entryIs(changeSetBody));
    }
  }
};
