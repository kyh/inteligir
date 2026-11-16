// A change set is one built-in agent turn's writes, which its Undo takes back; no other writer keeps
// one. The turn's first landing makes its set, keyed by the turn, and the push that ends the turn
// seals it, so one turn is one set. Each of the turn's landings joins the set's entry for its item
// (`./revert-change`), and nobody else's write touches it. A set keeps an item's fields; what it did
// to a note's body is that note's turn log, under the set's id.

import { canonicalJson } from "@repo/contract/library/canonical-json";
import { sameList } from "@repo/contract/library/field-ops";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { and, eq, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import { changeSetItems, changeSets } from "@repo/db/cell/schema";
import type { TurnActor } from "./cell-actor";
import { holdSetFiles, opFilesOf } from "./cell-blobs";
import { ensureJob } from "./cell-jobs";
import type { JobRequest } from "./cell-jobs";
import type { CellDb } from "./cell-db";
import { refuse } from "./cell-refusal";
import { PRUNE_EVERY_MS } from "./change-set-prune";
import { inverseOpSchema } from "./inverse-ops";
import { nextEntry } from "./revert-change";
import type { SetEntry } from "./revert-change";
import { jsonTextSchema } from "./sql-value";

// the change-set prune's job, made by whichever lands first, a sealed set or an op's answer,
// either of which it bounds, and run once a day
export const PRUNE_JOB: JobRequest<"prune"> = { id: "prune", kind: "prune", payload: {} };

type TurnKey = Pick<TurnActor, "threadId" | "turn">;

const turnIs = (turn: TurnKey): SQL | undefined =>
  and(eq(changeSets.threadId, turn.threadId), eq(changeSets.turn, turn.turn));

const entryIs = (setId: string, itemId: string): SQL | undefined =>
  and(eq(changeSetItems.changeSetId, setId), eq(changeSetItems.itemId, itemId));

export const ENTRY_COLUMNS = { inverse: changeSetItems.inverse, made: changeSetItems.made };

// an entry's row as this build writes it, exactly one column holding
const entryRowSchema = z.union([
  z
    .object({ inverse: z.null(), made: jsonTextSchema.pipe(libraryItemFieldsSchema) })
    .transform(({ made }): SetEntry => ({ fields: made, kind: "made" })),
  z
    .object({ inverse: jsonTextSchema.pipe(z.array(inverseOpSchema)), made: z.null() })
    .transform(({ inverse }): SetEntry => ({ inverse, kind: "changed" })),
]);

export const entryOf = (row: {
  readonly inverse: string | null;
  readonly made: string | null;
}): SetEntry => entryRowSchema.parse(row);

const rowOf = (entry: SetEntry) =>
  entry.kind === "made"
    ? { inverse: null, made: canonicalJson(entry.fields) }
    : { inverse: JSON.stringify(entry.inverse), made: null };

const filesOf = (entry: SetEntry | null): string[] =>
  entry?.kind === "changed" ? opFilesOf(entry.inverse) : [];

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

// the turn's set closed; a turn that changed nothing has none
export const sealTurnSet = (db: CellDb, turn: TurnKey, now: number): void => {
  const sealed = db
    .update(changeSets)
    .set({ sealedAt: now })
    .where(and(turnIs(turn), isNull(changeSets.sealedAt)))
    .returning({ id: changeSets.id })
    .all();
  if (sealed.length > 0) {
    ensureJob(db, PRUNE_JOB, now + PRUNE_EVERY_MS);
  }
};

// A landing on the item, which the turn's set takes into its entry when the landing is a turn's:
// `before` null when the landing made the item. The entry holds the files its ops would bring back.
export const recordLanding = (
  db: CellDb,
  landing: {
    readonly setId: string | null;
    readonly itemId: string;
    readonly before: LibraryItemFields | null;
    readonly after: LibraryItemFields;
  },
  now: number,
): void => {
  const { after, before, itemId, setId } = landing;
  if (setId === null) {
    return;
  }
  const row = db.select(ENTRY_COLUMNS).from(changeSetItems).where(entryIs(setId, itemId)).get();
  const prior = row === undefined ? null : entryOf(row);
  const entry = nextEntry(prior, before, after);
  db.insert(changeSetItems)
    .values({ changeSetId: setId, itemId, ...rowOf(entry) })
    .onConflictDoUpdate({
      set: rowOf(entry),
      target: [changeSetItems.changeSetId, changeSetItems.itemId],
    })
    .run();
  const files = filesOf(entry);
  if (!sameList(filesOf(prior), files)) {
    holdSetFiles(db, { changeSetId: setId, itemId }, files, now);
  }
};

// A page's reading of an item a set made folds into what the set made while the item stood as the
// set left it, so the set's Undo still takes back the item it made: a reading is no person's
// change.
export const foldReading = (
  db: CellDb,
  change: {
    readonly itemId: string;
    readonly before: LibraryItemFields;
    readonly after: LibraryItemFields;
  },
): void => {
  const [left, read] = [canonicalJson(change.before), canonicalJson(change.after)];
  if (left !== read) {
    db.update(changeSetItems)
      .set({ made: read })
      .where(and(eq(changeSetItems.itemId, change.itemId), eq(changeSetItems.made, left)))
      .run();
  }
};
