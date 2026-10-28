// What history keeps (owner decision 8): an item's newest 100 revisions; past those, everything
// from the last 30 days, and before that the day's last revision for each day. A dropped revision
// takes its change set's entry for that item with it, so the set can no longer undo that item, and
// then whatever part or block version nothing kept still names goes too. The job sweeps the
// library a page of items per alarm run, its place kept in its payload, and once a day.

import { chunkStatement } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { readManifest } from "./cell-parts";

const DAY_MS = 24 * 60 * 60_000;
const KEEP_NEWEST = 100;
const DAILY_AFTER_MS = 30 * DAY_MS;
// an op's id answers a resend for this long
const OP_ANSWER_MS = 30 * DAY_MS;
// the items one run sweeps, well inside an alarm's 30 s of CPU
const ITEMS_PER_RUN = 100;

export interface RevisionAt {
  readonly rev: number;
  readonly at: number;
}

// the revs to drop, of one item's revisions
export const revisionsToDrop = (revisions: readonly RevisionAt[], now: number): number[] => {
  const older = revisions.toSorted((a, b) => b.rev - a.rev).slice(KEEP_NEWEST);
  const lastOfDay = new Map<number, number>();
  for (const revision of older) {
    const day = Math.floor(revision.at / DAY_MS);
    lastOfDay.set(day, Math.max(lastOfDay.get(day) ?? 0, revision.rev));
  }
  return older
    .filter(
      (revision) =>
        now - revision.at > DAILY_AFTER_MS &&
        lastOfDay.get(Math.floor(revision.at / DAY_MS)) !== revision.rev,
    )
    .map((revision) => revision.rev)
    .toSorted((a, b) => a - b);
};

const revisionRowSchema = z.object({
  at: z.number(),
  change_set_id: z.string(),
  rev: z.number(),
});
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

// the parts and block versions no revision and no change set of the item still names
const collectGarbage = (sql: SqlStatements, itemId: string): void => {
  const named = new Set<string>();
  const manifests = new Set<string>();
  for (const raw of sql.all("SELECT fields, manifest FROM revisions WHERE item_id = ?", [itemId])) {
    const row = refsRowSchema.parse(raw);
    for (const hash of Object.values(row)) {
      if (hash !== null) {
        named.add(hash);
      }
    }
    if (row["manifest"] !== undefined && row["manifest"] !== null) {
      manifests.add(row["manifest"]);
    }
  }
  for (const raw of sql.all(
    `SELECT before_fields, before_manifest, before_annotations, after_fields, after_manifest,
       after_annotations FROM change_set_items WHERE item_id = ?`,
    [itemId],
  )) {
    const row = refsRowSchema.parse(raw);
    for (const hash of Object.values(row)) {
      if (hash !== null) {
        named.add(hash);
      }
    }
    for (const column of ["before_manifest", "after_manifest"] as const) {
      const hash = row[column];
      if (hash !== undefined && hash !== null) {
        manifests.add(hash);
      }
    }
  }
  const parts = sql
    .all("SELECT hash FROM snapshot_parts WHERE item_id = ?", [itemId])
    .map((row) => hashRowSchema.parse(row).hash);
  deleteIn(
    sql,
    "DELETE FROM snapshot_parts WHERE item_id = ? AND hash IN (",
    [itemId],
    parts.filter((hash) => !named.has(hash)),
  );
  const blocks = new Set<string>();
  for (const manifest of manifests) {
    for (const entry of readManifest(sql, itemId, manifest)) {
      blocks.add(entry.hash);
    }
  }
  const versions = sql
    .all("SELECT hash FROM block_versions WHERE item_id = ?", [itemId])
    .map((row) => hashRowSchema.parse(row).hash);
  deleteIn(
    sql,
    "DELETE FROM block_versions WHERE item_id = ? AND hash IN (",
    [itemId],
    versions.filter((hash) => !blocks.has(hash)),
  );
};

const pruneItemHistory = (sql: SqlStatements, itemId: string, now: number): void => {
  const revisions = sql
    .all("SELECT rev, at, change_set_id FROM revisions WHERE item_id = ?", [itemId])
    .map((row) => revisionRowSchema.parse(row));
  const drop = new Set(revisionsToDrop(revisions, now));
  for (const revision of revisions) {
    if (drop.has(revision.rev)) {
      sql.run("DELETE FROM revisions WHERE item_id = ? AND rev = ?", [itemId, revision.rev]);
      sql.run("DELETE FROM change_set_items WHERE change_set_id = ? AND item_id = ?", [
        revision.change_set_id,
        itemId,
      ]);
    }
  }
  collectGarbage(sql, itemId);
};

const itemRowSchema = z.object({ item_id: z.string() });

// one run's page of items after `after`, by id; the next page's start, or null once the sweep is
// done
export const pruneHistory = (
  sql: SqlStatements,
  now: number,
  after: string | null,
): string | null => {
  const items = sql
    .all(
      `SELECT item_id FROM (
         SELECT item_id FROM revisions UNION SELECT item_id FROM snapshot_parts
         UNION SELECT item_id FROM block_versions
       ) WHERE item_id > ? ORDER BY item_id LIMIT ?`,
      [after ?? "", ITEMS_PER_RUN],
    )
    .map((row) => itemRowSchema.parse(row).item_id);
  for (const itemId of items) {
    pruneItemHistory(sql, itemId, now);
  }
  sql.run("DELETE FROM applied_ops WHERE at < ?", [now - OP_ANSWER_MS]);
  // a sealed set whose every item's revision is gone shows nothing in History
  sql.run(
    `DELETE FROM change_sets WHERE sealed_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM change_set_items WHERE change_set_id = change_sets.id)`,
    [],
  );
  return items.length === ITEMS_PER_RUN ? (items.at(-1) ?? null) : null;
};

export const PRUNE_EVERY_MS = DAY_MS;
