// A change set is one built-in agent turn's writes, which its Undo takes back; no other writer keeps
// one. The turn's first landing that changes an item makes its set, keyed by the turn, and the turn's
// end seals it, so one turn is one set. Each of the turn's landings joins the set's entry for its
// item (`./revert-change`): its fields' way back, and the body it held before the turn's first write
// of it with the version the turn's last write left. An entry goes once an Undo settled it, with its
// item emptied from Deleted, or seven days after its turn ended (`pruneChangeSets`), so a set holds
// only what is left to take back.

import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { DbExecutor, Tx } from "@repo/db/drizzle-client";
import {
  changeSet,
  changeSetBody,
  changeSetFile,
  changeSetItem,
  file,
  itemBody,
  opAnswer,
} from "@repo/db/library-schema";
import { and, eq, inArray, isNotNull, isNull, lt, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import { holdSetFiles, releaseSetFiles } from "../files/file-names";
import { inverseOpSchema } from "./inverse-ops";
import type { InverseOp } from "./inverse-ops";
import { idleAccounts } from "./idle-accounts";
import { mintLibraryId } from "./library-ids";
import type { TurnActor } from "./library-principal";
import { refuse } from "./library-refusal";
import type { WriteScope } from "./library-store";
import { nextEntry } from "./revert-change";
import type { SetEntry } from "./revert-change";
import { anyOf } from "./set-sql";

const DAY_MS = 24 * 60 * 60_000;
// how far back Undo reaches: a set goes this long after its turn ended
const UNDO_REACH_MS = 7 * DAY_MS;
// an op's id answers a resend for this long
const OP_ANSWER_MS = 30 * DAY_MS;

type TurnKey = Pick<TurnActor, "threadId" | "turn">;

const turnIs = (accountId: string, turn: TurnKey) =>
  and(
    eq(changeSet.accountId, accountId),
    eq(changeSet.threadId, turn.threadId),
    eq(changeSet.turn, turn.turn),
  );

// an entry's row as a landing writes it, exactly one column holding
const entryRowSchema = z.union([
  z
    .object({ inverse: z.null(), made: libraryItemFieldsSchema })
    .transform(({ made }): SetEntry => ({ fields: made, kind: "made" })),
  z
    .object({ inverse: z.array(inverseOpSchema), made: z.null() })
    .transform(({ inverse }): SetEntry => ({ inverse, kind: "changed" })),
]);

export const ENTRY_COLUMNS = {
  inverse: changeSetItem.inverse,
  itemId: changeSetItem.itemId,
  made: changeSetItem.made,
};

export const entryOf = (row: { readonly inverse: unknown; readonly made: unknown }): SetEntry =>
  entryRowSchema.parse(row);

const rowOf = (entry: SetEntry) =>
  entry.kind === "made"
    ? { inverse: null, made: entry.fields }
    : { inverse: [...entry.inverse], made: null };

// the files an entry's way back would name again: an original or a cover it sets back
const opFilesOf = (ops: readonly InverseOp[]): string[] =>
  ops.flatMap((op) =>
    op.op === "set" && (op.field === "originalSha" || op.field === "coverSha") && op.value !== null
      ? [op.value]
      : [],
  );

// the set the turn's landings join, made by its first; a turn sealed is over, so it takes no more
export const joinTurnSet = async (
  tx: Tx,
  accountId: string,
  turn: TurnKey,
  now: number,
): Promise<string> => {
  const [held] = await tx
    .select({ id: changeSet.id, sealedAt: changeSet.sealedAt })
    .from(changeSet)
    .where(turnIs(accountId, turn));
  if (held === undefined) {
    const id = mintLibraryId(now);
    await tx.insert(changeSet).values({ accountId, id, threadId: turn.threadId, turn: turn.turn });
    return id;
  }
  return held.sealedAt === null ? held.id : refuse({ kind: "turn-ended" });
};

// the turn's set closed, so its Undo can take it back; a turn that changed nothing has none
export const sealTurnSet = async (
  db: DbExecutor,
  accountId: string,
  turn: TurnKey,
  now: number,
): Promise<void> => {
  await db
    .update(changeSet)
    .set({ sealedAt: now })
    .where(and(turnIs(accountId, turn), isNull(changeSet.sealedAt)));
};

// One landing on an item, which the turn's set takes into its entry when the write is a turn's:
// `before` null when the landing made the item, which already stands. The entry holds the files its
// way back would name, and `bodyFiles` the ones the body it takes back names
export const recordLanding = async (
  scope: WriteScope,
  setId: string,
  landing: {
    readonly itemId: string;
    readonly before: LibraryItemFields | null;
    readonly after: LibraryItemFields;
    readonly bodyFiles: readonly string[];
  },
): Promise<void> => {
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

// A body the turn writes, kept as it stood before the turn's first write of it, which this runs
// ahead of, so an Undo writes it back; `versionAfter` is the version this write leaves. One the
// turn makes stood nowhere, as no blocks at 0
export const recordBody = async (
  scope: WriteScope,
  setId: string,
  body: { readonly itemId: string; readonly made: boolean; readonly versionAfter: number },
): Promise<void> => {
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

// entries an Undo settled, gone with the bodies they kept and their hold on the files they named
export const dropEntries = async (
  scope: WriteScope,
  entries: readonly { readonly changeSetId: string; readonly itemIds: readonly string[] }[],
): Promise<void> => {
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

// Every set whose turn ended past Undo's reach, gone with its entries, and every ended set left
// with nothing to take back, of each account no write holds; the files only those sets named are
// touched, so each is let go a day on. Callable inside the caller's transaction; answers how many
// sets went
export const pruneChangeSets = async (tx: Tx, now: number): Promise<number> => {
  const reach = now - UNDO_REACH_MS;
  const past = and(
    inArray(
      changeSet.accountId,
      idleAccounts(
        tx,
        tx
          .selectDistinct({ accountId: changeSet.accountId })
          .from(changeSet)
          .where(isNotNull(changeSet.sealedAt)),
      ),
    ),
    isNotNull(changeSet.sealedAt),
  );
  const expired = and(past, lt(changeSet.sealedAt, reach));
  await tx
    .update(file)
    .set({ touchedAt: now })
    .where(
      sql`(${file.accountId}, ${file.sha256}) in ${tx
        .select({ accountId: changeSetFile.accountId, sha256: changeSetFile.sha256 })
        .from(changeSetFile)
        .innerJoin(
          changeSet,
          and(
            eq(changeSet.accountId, changeSetFile.accountId),
            eq(changeSet.id, changeSetFile.changeSetId),
          ),
        )
        .where(expired)}`,
    );
  const gone = await tx
    .delete(changeSet)
    .where(
      sql`${expired} or (${past} and ${notExists(
        tx
          .select({ held: sql`1` })
          .from(changeSetItem)
          .where(
            and(
              eq(changeSetItem.accountId, changeSet.accountId),
              eq(changeSetItem.changeSetId, changeSet.id),
            ),
          ),
      )})`,
    )
    .returning({ id: changeSet.id });
  return gone.length;
};

// every op's answer kept past a resend's reach, of each account no write holds; callable inside the
// caller's transaction, it answers how many went
export const pruneOpAnswers = async (tx: Tx, now: number): Promise<number> => {
  const reach = now - OP_ANSWER_MS;
  const gone = await tx
    .delete(opAnswer)
    .where(
      and(
        lt(opAnswer.at, reach),
        inArray(
          opAnswer.accountId,
          idleAccounts(
            tx,
            tx
              .selectDistinct({ accountId: opAnswer.accountId })
              .from(opAnswer)
              .where(lt(opAnswer.at, reach)),
          ),
        ),
      ),
    )
    .returning({ opId: opAnswer.opId });
  return gone.length;
};
