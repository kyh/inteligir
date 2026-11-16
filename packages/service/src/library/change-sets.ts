// A change set is one built-in agent turn's writes, which its Undo takes back; no other writer keeps
// one. The turn's first landing makes its set, keyed by the turn, and the push that ends the turn
// seals it, so one turn is one set. Each item a set touches keeps its state before the set's first
// write; its after is the item as it is while the set is the last to have changed it, written down
// when the set seals or anyone else is about to change the item, so a set's after is the item as
// that set left it. A set keeps an item's fields; what it did to a note's body is that note's turn
// log, under the set's id.

import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { readLiveItem } from "./library-queries";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { changeSetItems, changeSets } from "@repo/db/cell/schema";
import type { TurnActor } from "./cell-actor";
import { ensureJob } from "./cell-jobs";
import type { JobRequest } from "./cell-jobs";
import type { CellDb } from "./cell-db";
import { fieldsPartHash, storeFieldsPart } from "./cell-parts";
import { refuse } from "./cell-refusal";
import { PRUNE_EVERY_MS } from "./change-set-prune";

// the change-set prune's job, made by whichever lands first, a sealed set or an op's answer,
// either of which it bounds, and run once a day
export const PRUNE_JOB: JobRequest<"prune"> = { id: "prune", kind: "prune", payload: {} };

type TurnKey = Pick<TurnActor, "threadId" | "turn">;

const turnIs = (turn: TurnKey): SQL | undefined =>
  and(eq(changeSets.threadId, turn.threadId), eq(changeSets.turn, turn.turn));

const entryIs = (setId: string, itemId: string): SQL | undefined =>
  and(eq(changeSetItems.changeSetId, setId), eq(changeSetItems.itemId, itemId));

// the set's after for the item: its fields as the set left them
const writeAfter = (
  db: CellDb,
  change: { readonly setId: string; readonly itemId: string; readonly fields: string | null },
): void => {
  db.update(changeSetItems)
    .set({ afterFields: change.fields })
    .where(entryIs(change.setId, change.itemId))
    .run();
};

// the set the turn's landings join, made by its first; a turn sealed is over, so it takes no more
export const joinTurnSet = (
  db: CellDb,
  turn: TurnKey,
  now: number,
  newId: () => string,
): string => {
  const held = db
    .select({ id: changeSets.id, sealedAt: changeSets.sealedAt })
    .from(changeSets)
    .where(turnIs(turn))
    .get();
  if (held === undefined) {
    const id = newId();
    db.insert(changeSets)
      .values({ id, openedAt: now, threadId: turn.threadId, turn: turn.turn })
      .run();
    return id;
  }
  return held.sealedAt === null ? held.id : refuse({ kind: "turn-ended" });
};

// the turn's set closed, each item it still holds open given its after; a turn that changed
// nothing has none. An item another writer changed since already has its after, written at that
// change
export const sealTurnSet = (db: CellDb, turn: TurnKey, now: number): void => {
  const set = db
    .select({ id: changeSets.id })
    .from(changeSets)
    .where(and(turnIs(turn), isNull(changeSets.sealedAt)))
    .get();
  if (set === undefined) {
    return;
  }
  const entries = db
    .select({ itemId: changeSetItems.itemId })
    .from(changeSetItems)
    .where(and(eq(changeSetItems.changeSetId, set.id), isNull(changeSetItems.afterFields)))
    .all();
  for (const { itemId } of entries) {
    const current = readLiveItem(db, itemId)?.fields ?? null;
    if (current === null) {
      db.delete(changeSetItems).where(entryIs(set.id, itemId)).run();
      continue;
    }
    writeAfter(db, { fields: storeFieldsPart(db, itemId, current), itemId, setId: set.id });
  }
  db.update(changeSets).set({ sealedAt: now }).where(eq(changeSets.id, set.id)).run();
  ensureJob(db, PRUNE_JOB, now + PRUNE_EVERY_MS);
};

// A write about to change the item: each open set whose after is the item as it is now writes that
// after down, since this write is about to change it; and when the write is a turn's, its set's
// first write to the item keeps the item as it was, its later ones take the item back as its own.
export const touchItem = (
  db: CellDb,
  change: {
    readonly setId: string | null;
    readonly itemId: string;
    readonly before: LibraryItemFields | null;
  },
): void => {
  const { before, itemId, setId } = change;
  const held =
    setId === null
      ? undefined
      : db
          .select({ afterFields: changeSetItems.afterFields })
          .from(changeSetItems)
          .where(entryIs(setId, itemId))
          .get();
  const others = db
    .select({ changeSetId: changeSetItems.changeSetId })
    .from(changeSetItems)
    .where(
      and(
        eq(changeSetItems.itemId, itemId),
        setId === null ? undefined : ne(changeSetItems.changeSetId, setId),
        isNull(changeSetItems.afterFields),
      ),
    )
    .all()
    .map((row) => row.changeSetId);
  const fields =
    before !== null && ((setId !== null && held === undefined) || others.length > 0)
      ? storeFieldsPart(db, itemId, before)
      : null;
  if (fields !== null) {
    for (const other of others) {
      writeAfter(db, { fields, itemId, setId: other });
    }
  }
  if (setId === null) {
    return;
  }
  if (held === undefined) {
    db.insert(changeSetItems)
      .values({
        beforeFields: fields,
        changeSetId: setId,
        created: before === null ? 1 : 0,
        itemId,
      })
      .run();
  } else if (held.afterFields !== null) {
    // written down when another writer wrote; the item is this set's again
    writeAfter(db, { fields: null, itemId, setId });
  }
};

// A page's reading of an item a set made folds into that set's after while the item stood as the
// set left it, so the set's Undo still takes back the item it made: a reading is no person's
// change. Runs after the reading landed, whose own write already wrote every open set's after down.
export const foldReading = (
  db: CellDb,
  change: {
    readonly itemId: string;
    readonly before: LibraryItemFields;
    readonly after: LibraryItemFields;
  },
): void => {
  const { after, before, itemId } = change;
  const left = fieldsPartHash(before);
  if (left === fieldsPartHash(after)) {
    return;
  }
  const made = db
    .select({ changeSetId: changeSetItems.changeSetId })
    .from(changeSetItems)
    .where(
      and(
        eq(changeSetItems.itemId, itemId),
        eq(changeSetItems.created, 1),
        eq(changeSetItems.afterFields, left),
      ),
    )
    .all();
  if (made.length === 0) {
    return;
  }
  const fields = storeFieldsPart(db, itemId, after);
  for (const { changeSetId } of made) {
    writeAfter(db, { fields, itemId, setId: changeSetId });
  }
};
