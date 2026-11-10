// How far back Undo reaches: a change set goes seven days after it closed, its hold on every item
// it changed with it, and then whatever fields part of those items no set still names, with the
// files only they held. The job drops a page of entries per alarm run, again at once while
// more wait, and otherwise once a day.

import { chunkStatement } from "./library-sql";
import type { SqlStatements } from "./library-sql";
import { z } from "zod";

import { dropSetFiles } from "./cell-blobs";
import type { CellStorage } from "./cell-storage";

const DAY_MS = 24 * 60 * 60_000;
export const UNDO_REACH_MS = 7 * DAY_MS;
// an op's id answers a resend for this long
const OP_ANSWER_MS = 30 * DAY_MS;
// the entries one run drops, well inside an alarm's 30 s of CPU
const ENTRIES_PER_RUN = 100;

export const PRUNE_EVERY_MS = DAY_MS;

const entryRowSchema = z.object({ change_set_id: z.string(), item_id: z.string() });
const hashRowSchema = z.object({ hash: z.string() });
const refsRowSchema = z.record(z.string(), z.string().nullable());

const deleteIn = (
  sql: SqlStatements,
  head: string,
  headParams: readonly (string | number)[],
  ids: readonly string[],
): void => {
  for (const statement of chunkStatement({
    each: "?",
    head,
    headParams,
    rows: ids.map((id) => [id]),
    separator: ", ",
    tail: ")",
  })) {
    sql.run(statement.sql, statement.params);
  }
};

// the parts of the item no change set still names, and what they alone held of the library's files
const collectGarbage = (storage: CellStorage, itemId: string, now: number): void => {
  const named = new Set<string>();
  for (const raw of storage.all(
    "SELECT before_fields, after_fields FROM change_set_items WHERE item_id = ?",
    [itemId],
  )) {
    for (const hash of Object.values(refsRowSchema.parse(raw))) {
      if (hash !== null) {
        named.add(hash);
      }
    }
  }
  const parts = storage
    .all("SELECT hash FROM snapshot_parts WHERE item_id = ?", [itemId])
    .map((row) => hashRowSchema.parse(row).hash)
    .filter((hash) => !named.has(hash));
  deleteIn(storage, "DELETE FROM snapshot_parts WHERE item_id = ? AND hash IN (", [itemId], parts);
  dropSetFiles(storage, itemId, parts, now);
};

// one run's page; whether more wait for the next
export const pruneChangeSets = (storage: CellStorage, now: number): boolean => {
  const closedBefore = now - UNDO_REACH_MS;
  const entries = storage
    .all(
      `SELECT change_set_id, item_id FROM change_set_items WHERE change_set_id IN (
         SELECT id FROM change_sets WHERE sealed_at < ?) LIMIT ?`,
      [closedBefore, ENTRIES_PER_RUN],
    )
    .map((row) => entryRowSchema.parse(row));
  for (const entry of entries) {
    storage.run("DELETE FROM change_set_items WHERE change_set_id = ? AND item_id = ?", [
      entry.change_set_id,
      entry.item_id,
    ]);
  }
  for (const itemId of new Set(entries.map((entry) => entry.item_id))) {
    collectGarbage(storage, itemId, now);
  }
  // a closed set with nothing left to take back, however recent, is nothing to undo
  storage.run(
    `DELETE FROM change_sets WHERE sealed_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM change_set_items WHERE change_set_id = change_sets.id)`,
    [],
  );
  storage.run("DELETE FROM applied_ops WHERE at < ?", [now - OP_ANSWER_MS]);
  return entries.length === ENTRIES_PER_RUN;
};
