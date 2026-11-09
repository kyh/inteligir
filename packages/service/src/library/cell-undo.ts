// Undo takes change sets back in one write of its own: newest set first, each item run backwards
// by `@repo/service/library/revert-change` against the item as the newer sets' undo left it, so an
// item someone changed since stays whole and is named. An item whose way back a rule refuses (its
// url now another live item's, a file gone, the quota) is named apart and the rest land, and its
// set stays undoable, since room or the address can come back; when nothing lands the rule's
// refusal is the answer. A set of which only kept items remain stays undoable too, since the edit
// since can go, and when no set moved no write of its own is made.

import { compareText } from "@repo/contract/library/order-key";
import { revertChangeSets } from "./revert-change";
import type { FillChange, ItemChange, ItemNow } from "./revert-change";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { chunkStatement } from "./library-sql";
import type { SqlStatements } from "./library-sql";
import { z } from "zod";

import { askFill } from "./cell-fills";
import { landItem } from "./cell-landing";
import type { LandingScope } from "./cell-landing";
import { blockContents, readFieldsPart, readSnapshot } from "./cell-parts";
import { refuse, RefusedWriteError } from "./cell-refusal";
import type { CellRefusal } from "./cell-refusal";
import { readItemNow, sealChangeSet } from "./change-sets";

export interface UndoAnswer {
  // null: no item went back and no set was undone, so no undo was made
  readonly changeSetId: string | null;
  readonly kept: readonly string[];
  readonly refused: readonly string[];
  readonly reverted: readonly string[];
}

const setRowSchema = z.object({
  id: z.string(),
  opened_at: z.number(),
  sealed_at: z.number().nullable(),
  undone_by: z.string().nullable(),
});

const setItemSchema = z.object({
  after_fields: z.string().nullable(),
  after_manifest: z.string().nullable(),
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

const fillRowSchema = z.object({ after_fields: z.string(), before_fields: z.string() });

const fillsOf = (sql: SqlStatements, itemId: string): FillChange[] =>
  sql
    .all(
      `SELECT items.before_fields, items.after_fields
       FROM change_set_items items JOIN change_sets sets ON sets.id = items.change_set_id
       WHERE items.item_id = ? AND sets.actor = 'fill'
         AND items.before_fields IS NOT NULL AND items.after_fields IS NOT NULL`,
      [itemId],
    )
    .map((raw) => {
      const row = fillRowSchema.parse(raw);
      return {
        after: readFieldsPart(sql, itemId, row.after_fields),
        before: readFieldsPart(sql, itemId, row.before_fields),
      };
    });

const changesOf = (sql: SqlStatements, setId: string): Map<string, ItemChange> => {
  const changes = new Map<string, ItemChange>();
  for (const raw of sql.all(
    `SELECT item_id, before_fields, before_manifest, after_fields, after_manifest
     FROM change_set_items WHERE change_set_id = ?`,
    [setId],
  )) {
    const row = setItemSchema.parse(raw);
    if (row.after_fields === null || row.after_manifest === null) {
      continue;
    }
    const after = readSnapshot(sql, row.item_id, {
      fields: row.after_fields,
      manifest: row.after_manifest,
    });
    changes.set(
      row.item_id,
      row.before_fields === null || row.before_manifest === null
        ? { after, before: null, fills: fillsOf(sql, row.item_id) }
        : {
            after,
            before: readSnapshot(sql, row.item_id, {
              fields: row.before_fields,
              manifest: row.before_manifest,
            }),
          },
    );
  }
  return changes;
};

// the undo's own set, named on each set it settled
const markUndone = (scope: LandingScope, settled: readonly { readonly id: string }[]): string => {
  const undoSet = scope.set();
  for (const set of settled) {
    scope.storage.run("UPDATE change_sets SET undone_by = ? WHERE id = ?", [undoSet.id, set.id]);
  }
  return undoSet.id;
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
  const refused = new Map<string, CellRefusal>();
  for (const [itemId, undo] of verdict.items) {
    const current = items.get(itemId) ?? null;
    if (current === null) {
      kept.add(itemId);
      continue;
    }
    try {
      const landed = landItem(scope, {
        after: undo.now.state,
        before: current.state,
        itemId,
      });
      // no turn to hold it for: the built-in agent has no undo
      askFill(scope, landed);
      reverted.push(itemId);
    } catch (error) {
      // a rule refused this item's way back before anything of it was written
      if (!(error instanceof RefusedWriteError)) {
        throw error;
      }
      refused.set(itemId, error.refusal);
    }
  }
  const settled = ordered.filter(
    (set) => !verdict.leftWhole.has(set.id) && ![...set.items.keys()].some((id) => refused.has(id)),
  );
  const [first] = refused.values();
  const moved = reverted.length > 0 || settled.length > 0;
  if (first !== undefined && !moved) {
    refuse(first);
  }
  return {
    changeSetId: moved ? markUndone(scope, settled) : null,
    kept: [...kept].filter((id) => !refused.has(id)).toSorted(),
    refused: [...refused.keys()].toSorted(),
    reverted: reverted.toSorted(),
  };
};
