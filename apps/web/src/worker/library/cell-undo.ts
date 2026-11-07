// Undo takes change sets back in one write of its own: newest set first, each item run backwards
// by `@repo/notes/library/revert-change` against the item as the newer sets' undo left it, so an
// item someone changed since stays whole and is named. An item whose way back a rule refuses (its
// url now another live item's, a file gone, the quota) is named apart and the rest land, and its
// set stays undoable, since room or the address can come back; when nothing lands the rule's
// refusal is the answer. A set of which only kept items remain stays undoable too, since the edit
// since can go, and when no set moved no write of its own is made.

import { compareText } from "@repo/notes/library/block-order";
import { revertChangeSets } from "@repo/notes/library/revert-change";
import type {
  FillChange,
  ItemChange,
  ItemNow,
  ItemSnapshot,
} from "@repo/notes/library/revert-change";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { chunkStatement } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { readAnnotationRows, restoreAnnotationStore } from "./cell-annotations";
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

const foldRowSchema = z.object({
  after_annotations: z.string(),
  after_fields: z.string(),
  after_manifest: z.string(),
  stub_set: z.string(),
});

// where each fold of a stub one of `undoing` made left the item: a fold is the one fill whose set
// holds a second item, the stub it carried over
const foldsOf = (
  sql: SqlStatements,
  itemId: string,
  undoing: ReadonlySet<string>,
): ItemSnapshot[] =>
  sql
    .all(
      `SELECT items.after_fields, items.after_manifest, items.after_annotations,
         made.change_set_id AS stub_set
       FROM change_set_items items
       JOIN change_sets sets ON sets.id = items.change_set_id
       JOIN change_set_items stub
         ON stub.change_set_id = items.change_set_id AND stub.item_id != items.item_id
       JOIN change_set_items made ON made.item_id = stub.item_id AND made.created = 1
       WHERE items.item_id = ? AND sets.actor = 'fill' AND items.after_fields IS NOT NULL`,
      [itemId],
    )
    .map((raw) => foldRowSchema.parse(raw))
    .filter((row) => undoing.has(row.stub_set))
    .map((row) =>
      readSnapshot(sql, itemId, {
        annotations: row.after_annotations,
        fields: row.after_fields,
        manifest: row.after_manifest,
      }),
    );

const changesOf = (
  sql: SqlStatements,
  setId: string,
  undoing: ReadonlySet<string>,
): Map<string, ItemChange> => {
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
    changes.set(
      row.item_id,
      row.before_fields === null || row.before_manifest === null || row.before_annotations === null
        ? {
            after,
            before: null,
            fills: fillsOf(sql, row.item_id),
            folds: foldsOf(sql, row.item_id, undoing),
          }
        : {
            after,
            before: readSnapshot(sql, row.item_id, {
              annotations: row.before_annotations,
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
  const undoing = new Set(changeSetIds);
  const ordered = newestFirst.map((set) => ({
    id: set.id,
    items: changesOf(storage, set.id, undoing),
  }));
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
    const rows = readAnnotationRows(storage, itemId);
    try {
      const landed = landItem(scope, {
        after: undo.now.state,
        annotations: restoreAnnotationStore(rows, undo.now.annotations, {
          itemId,
          nowSeconds: Math.floor(now / 1000),
        }),
        before: { rows, state: current.state },
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
