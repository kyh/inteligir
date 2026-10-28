// Undo takes change sets back in one write of its own: newest set first, each item run backwards
// by `@repo/notes/library/revert-change` against the item as the newer sets' undo left it, so an
// item someone changed since stays whole and is named. An item whose way back a rule refuses (its
// url now another live item's, a file gone, the quota) is kept and named too, and the rest land.

import { compareText } from "@repo/notes/library/block-order";
import { revertChangeSets } from "@repo/notes/library/revert-change";
import type { ItemChange, ItemNow } from "@repo/notes/library/revert-change";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { chunkStatement } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { readAnnotationRows, restoreAnnotationStore } from "./cell-annotations";
import { landItem } from "./cell-landing";
import type { LandingScope } from "./cell-landing";
import { blockContents, readSnapshot } from "./cell-parts";
import { refuse, RefusedWriteError } from "./cell-refusal";
import { readItemNow, sealChangeSet } from "./change-sets";

export interface UndoAnswer {
  readonly changeSetId: string;
  readonly kept: readonly string[];
  readonly reverted: readonly string[];
}

const setRowSchema = z.object({
  id: z.string(),
  opened_at: z.number(),
  sealed_at: z.number().nullable(),
  undone_by: z.string().nullable(),
});

const setItemSchema = z.object({
  after_annotations: z.string().nullable(),
  after_fields: z.string().nullable(),
  after_manifest: z.string().nullable(),
  before_annotations: z.string().nullable(),
  before_fields: z.string().nullable(),
  before_manifest: z.string().nullable(),
  item_id: z.string(),
});

const loadSets = (sql: SqlStatements, ids: readonly string[]) => {
  const rows: z.infer<typeof setRowSchema>[] = [];
  for (const statement of chunkStatement({
    each: "?",
    head: "SELECT id, opened_at, sealed_at, undone_by FROM change_sets WHERE id IN (",
    rows: [...new Set(ids)].map((id) => [id]),
    separator: ", ",
    tail: ")",
  })) {
    rows.push(...sql.all(statement.sql, statement.params).map((row) => setRowSchema.parse(row)));
  }
  return rows;
};

const changesOf = (sql: SqlStatements, setId: string): Map<string, ItemChange> => {
  const changes = new Map<string, ItemChange>();
  for (const raw of sql.all(
    `SELECT item_id, before_fields, before_manifest, before_annotations, after_fields,
       after_manifest, after_annotations FROM change_set_items WHERE change_set_id = ?`,
    [setId],
  )) {
    const row = setItemSchema.parse(raw);
    if (
      row.after_fields === null ||
      row.after_manifest === null ||
      row.after_annotations === null
    ) {
      continue;
    }
    const after = readSnapshot(sql, row.item_id, {
      annotations: row.after_annotations,
      fields: row.after_fields,
      manifest: row.after_manifest,
    });
    const before =
      row.before_fields === null || row.before_manifest === null || row.before_annotations === null
        ? null
        : readSnapshot(sql, row.item_id, {
            annotations: row.before_annotations,
            fields: row.before_fields,
            manifest: row.before_manifest,
          });
    changes.set(row.item_id, { after, before });
  }
  return changes;
};

export const undoChangeSets = (
  scope: LandingScope,
  changeSetIds: readonly string[],
): UndoAnswer => {
  const { now, storage } = scope;
  const sets = loadSets(storage, changeSetIds);
  if (sets.length !== new Set(changeSetIds).size) {
    refuse({ kind: "not-found" });
  }
  for (const set of sets) {
    if (set.undone_by !== null) {
      refuse({ changeSetId: set.id, kind: "already-undone", undoneBy: set.undone_by });
    }
  }
  // a set still open closes first, so what it did is fixed
  for (const set of sets) {
    if (set.sealed_at === null) {
      sealChangeSet(storage, set.id, now);
    }
  }
  const newestFirst = sets.toSorted((a, b) => b.opened_at - a.opened_at || compareText(b.id, a.id));
  const ordered = newestFirst.map((set) => ({ id: set.id, items: changesOf(storage, set.id) }));
  const items = new Map<string, ItemNow | null>();
  const blocks = new Map<string, LibraryBlock>();
  for (const set of ordered) {
    for (const [itemId, change] of set.items) {
      if (!items.has(itemId)) {
        items.set(itemId, readItemNow(storage, itemId));
      }
      const hashes = new Set(change.before?.manifest.map((entry) => entry.hash));
      for (const [hash, block] of blockContents(storage, itemId, hashes)) {
        blocks.set(hash, block);
      }
    }
  }
  const verdict = revertChangeSets({
    at: now,
    blockAt: (hash) => blocks.get(hash),
    now: items,
    sets: ordered,
  });
  const kept = new Set(verdict.kept.map((entry) => entry.itemId));
  const reverted: string[] = [];
  for (const [itemId, undo] of verdict.items) {
    const current = items.get(itemId) ?? null;
    if (current === null) {
      kept.add(itemId);
      continue;
    }
    const rows = readAnnotationRows(storage, itemId);
    try {
      landItem(scope, {
        after: undo.now.state,
        annotations: restoreAnnotationStore(rows, undo.now.annotations, {
          itemId,
          nowSeconds: Math.floor(now / 1000),
        }),
        before: { rows, state: current.state },
        itemId,
      });
      reverted.push(itemId);
    } catch (error) {
      // a rule refused this item's way back before anything of it was written
      if (!(error instanceof RefusedWriteError)) {
        throw error;
      }
      kept.add(itemId);
    }
  }
  const undoSet = scope.set();
  for (const set of sets) {
    storage.run("UPDATE change_sets SET undone_by = ? WHERE id = ?", [undoSet.id, set.id]);
  }
  return {
    changeSetId: undoSet.id,
    kept: [...kept].filter((id) => !reverted.includes(id)).toSorted(),
    reverted: reverted.toSorted(),
  };
};
