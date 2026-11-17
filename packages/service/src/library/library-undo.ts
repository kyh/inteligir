// Undo takes back what a thread's ended turns changed, in one write: one turn's change set, or the
// conversation's, newest first, so many turns a call. Each set's entry for an item is landed by
// `./revert-change` on the item as the newer sets' undo left it, its fields and its body together,
// so an item someone changed since, in a field or its body, stays whole and is named. An entry the
// write settled goes, so a set holds only what is left to take back and a turn undone twice has
// nothing left. An item kept stays, since the edit since can go, and so does one whose way back a
// rule refuses (its url now another live item's, a file gone), since the file or the address can
// come back; when a rule held back all that could land, its refusal is the answer.

import type { DbExecutor } from "@repo/db/drizzle-client";
import { changeSet, changeSetBody, changeSetItem, item, itemBody } from "@repo/db/library-schema";
import { and, asc, desc, eq, exists, isNotNull, lt } from "drizzle-orm";
import { z } from "zod";

import { dropEntries, ENTRY_COLUMNS, entryOf } from "./library-change-sets";
import { askFills } from "./library-fills";
import { landItem } from "./library-landing";
import type { LiveItemRow } from "./library-landing";
import { refuse } from "./library-refusal";
import type { LibraryRefusal } from "./library-refusal";
import { STORED_ITEM_COLUMNS } from "./library-rows";
import type { WriteScope } from "./library-store";
import { revertChangeSets } from "./revert-change";
import type { BodyEntry, ItemEntry, ItemNow } from "./revert-change";
import { anyOf } from "./set-sql";

// the turns one undo takes back, which holds a call to the items that many turns wrote; a
// conversation of more goes a lot a call
const UNDO_TURNS_MAX = 50;

// which of a thread's turns an undo takes back: one, or the conversation's before `before`
type UndoTarget =
  | { readonly threadId: string; readonly turn: number }
  | { readonly threadId: string; readonly before?: number | undefined };

export const undoneSchema = z.object({
  kept: z.array(z.string()),
  // where the conversation's turns this undo left start, null when none wait
  next: z.number().nullable(),
  refused: z.array(z.string()),
  reverted: z.array(z.string()),
});

// a set Undo takes back: its turn ended, and something of it is left
const undoable = (db: DbExecutor, accountId: string, threadId: string) =>
  and(
    eq(changeSet.accountId, accountId),
    eq(changeSet.threadId, threadId),
    isNotNull(changeSet.sealedAt),
    exists(
      db
        .select({ id: changeSetItem.changeSetId })
        .from(changeSetItem)
        .where(
          and(
            eq(changeSetItem.accountId, changeSet.accountId),
            eq(changeSetItem.changeSetId, changeSet.id),
          ),
        ),
    ),
  );

const turnsOf = (target: UndoTarget) => {
  if ("turn" in target) {
    return eq(changeSet.turn, target.turn);
  }
  return target.before === undefined ? undefined : lt(changeSet.turn, target.before);
};

// the thread's turns Undo can still take back, oldest first
export const undoableTurns = async (
  db: DbExecutor,
  accountId: string,
  threadId: string,
): Promise<number[]> => {
  const rows = await db
    .select({ turn: changeSet.turn })
    .from(changeSet)
    .where(undoable(db, accountId, threadId))
    .orderBy(asc(changeSet.turn));
  return rows.map(({ turn }) => turn);
};

interface SetEntries {
  readonly id: string;
  readonly items: ReadonlyMap<string, ItemEntry>;
}

// what each set did to each item, newest set first
const entriesOf = async (scope: WriteScope, setIds: readonly string[]): Promise<SetEntries[]> => {
  const { accountId, tx } = scope;
  const [fields, bodies] = await Promise.all([
    tx
      .select({ ...ENTRY_COLUMNS, changeSetId: changeSetItem.changeSetId })
      .from(changeSetItem)
      .where(and(eq(changeSetItem.accountId, accountId), anyOf(changeSetItem.changeSetId, setIds))),
    tx
      .select({
        blocksBefore: changeSetBody.blocksBefore,
        changeSetId: changeSetBody.changeSetId,
        itemId: changeSetBody.itemId,
        versionAfter: changeSetBody.versionAfter,
        versionBefore: changeSetBody.versionBefore,
      })
      .from(changeSetBody)
      .where(and(eq(changeSetBody.accountId, accountId), anyOf(changeSetBody.changeSetId, setIds))),
  ]);
  const bodyOf = new Map<string, BodyEntry>(
    bodies.map(({ changeSetId, itemId, ...body }) => [`${changeSetId}/${itemId}`, body]),
  );
  return setIds.map((id) => ({
    id,
    items: new Map(
      fields
        .filter((row) => row.changeSetId === id)
        .map((row): [string, ItemEntry] => [
          row.itemId,
          { body: bodyOf.get(`${id}/${row.itemId}`) ?? null, fields: entryOf(row) },
        ]),
    ),
  }));
};

// each item the sets touched as it stands, with its body's version; an item purged since is absent
const itemsNow = async (scope: WriteScope, itemIds: readonly string[]) => {
  const { accountId, tx } = scope;
  const rows = await tx
    .select({ ...STORED_ITEM_COLUMNS, bodyVersion: itemBody.version })
    .from(item)
    .innerJoin(itemBody, and(eq(itemBody.accountId, item.accountId), eq(itemBody.itemId, item.id)))
    .where(and(eq(item.accountId, accountId), anyOf(item.id, itemIds)));
  return new Map(rows.map(({ bodyVersion, ...stored }) => [stored.id, { bodyVersion, stored }]));
};

// the sets an undo takes back, newest first, and where the turns it leaves start
const pickSets = async (scope: WriteScope, target: UndoTarget) => {
  const waiting = await scope.tx
    .select({ id: changeSet.id, turn: changeSet.turn })
    .from(changeSet)
    .where(and(undoable(scope.tx, scope.accountId, target.threadId), turnsOf(target)))
    .orderBy(desc(changeSet.turn))
    .limit(UNDO_TURNS_MAX + 1);
  const sets = waiting.slice(0, UNDO_TURNS_MAX);
  return {
    // a lot all kept or refused stays undoable, so the next lot starts below this one, never at it
    next: waiting.length > sets.length ? (sets.at(-1)?.turn ?? null) : null,
    setIds: sets.map((set) => set.id),
  };
};

export const undoTurns = async (
  scope: WriteScope,
  target: UndoTarget,
): Promise<z.input<typeof undoneSchema>> => {
  const { next, setIds } = await pickSets(scope, target);
  const sets = await entriesOf(scope, setIds);
  const held = await itemsNow(scope, [...new Set(sets.flatMap((set) => [...set.items.keys()]))]);
  const now = new Map<string, ItemNow | null>(
    [...held].map(([id, { bodyVersion, stored }]) => [id, { bodyVersion, fields: stored.fields }]),
  );
  const verdict = revertChangeSets({ at: scope.now, now, sets });
  const reverted: LiveItemRow[] = [];
  const refused = new Map<string, LibraryRefusal>();
  for (const [itemId, back] of verdict.items) {
    const before = held.get(itemId)?.stored;
    if (before !== undefined) {
      const landed = await scope.attempt(
        async (part) =>
          await landItem(part, { before, body: back.blocks, fields: back.fields, itemId }),
      );
      if (landed.ok) {
        reverted.push(landed.value);
      } else {
        refused.set(itemId, landed.refusal);
      }
    }
  }
  const [first] = refused.values();
  if (first !== undefined && reverted.length === 0) {
    refuse(first);
  }
  await askFills(scope, reverted);
  // an entry kept or refused stays to undo again; every other is settled, and goes
  const keptIds = new Set(verdict.kept.map((kept) => `${kept.setId}/${kept.itemId}`));
  await dropEntries(
    scope,
    sets.map((set) => ({
      changeSetId: set.id,
      itemIds: [...set.items.keys()].filter(
        (itemId) => !keptIds.has(`${set.id}/${itemId}`) && !refused.has(itemId),
      ),
    })),
  );
  return {
    kept: [...new Set(verdict.kept.map((kept) => kept.itemId))]
      .filter((id) => !refused.has(id))
      .toSorted(),
    next,
    refused: [...refused.keys()].toSorted(),
    reverted: reverted.map((row) => row.id).toSorted(),
  };
};
