// How far back Undo reaches: a change set goes seven days after it closed, its entries with it, and
// then the files only they held. The job drops a page of entries per alarm run, again at once while
// more wait, and otherwise once a day.

import { and, eq, inArray, isNotNull, lt, notExists } from "drizzle-orm";

import { appliedOps, changeSetItems, changeSets } from "@repo/db/cell/schema";
import { holdSetFiles } from "./cell-blobs";
import type { CellDb } from "./cell-db";

const DAY_MS = 24 * 60 * 60_000;
export const UNDO_REACH_MS = 7 * DAY_MS;
// an op's id answers a resend for this long
const OP_ANSWER_MS = 30 * DAY_MS;
// the entries one run drops, well inside an alarm's 30 s of CPU
const ENTRIES_PER_RUN = 100;

export const PRUNE_EVERY_MS = DAY_MS;

// one run's page; whether more wait for the next
export const pruneChangeSets = (db: CellDb, now: number): boolean => {
  const closed = db
    .select({ id: changeSets.id })
    .from(changeSets)
    .where(lt(changeSets.sealedAt, now - UNDO_REACH_MS));
  const entries = db
    .select({ changeSetId: changeSetItems.changeSetId, itemId: changeSetItems.itemId })
    .from(changeSetItems)
    .where(inArray(changeSetItems.changeSetId, closed))
    .limit(ENTRIES_PER_RUN)
    .all();
  for (const entry of entries) {
    db.delete(changeSetItems)
      .where(
        and(
          eq(changeSetItems.changeSetId, entry.changeSetId),
          eq(changeSetItems.itemId, entry.itemId),
        ),
      )
      .run();
    holdSetFiles(db, entry, [], now);
  }
  // a closed set with nothing left to take back, however recent, is nothing to undo
  db.delete(changeSets)
    .where(
      and(
        isNotNull(changeSets.sealedAt),
        notExists(
          db
            .select({ id: changeSetItems.changeSetId })
            .from(changeSetItems)
            .where(eq(changeSetItems.changeSetId, changeSets.id)),
        ),
      ),
    )
    .run();
  db.delete(appliedOps)
    .where(lt(appliedOps.at, now - OP_ANSWER_MS))
    .run();
  return entries.length === ENTRIES_PER_RUN;
};
