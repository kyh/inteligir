// Undo takes change sets back in one write of its own: newest set first, each item's fields run
// backwards by `./revert-change` against the item as the newer sets' undo left it, so an item
// someone changed since stays whole and is named. What an agent's set did to a note's body its note
// undoes first, outside any transaction (`planUndo` names those notes), and the write lands what
// each note answered: its body after, whether the undo took someone's text, whether anyone but an
// agent wrote there. An item whose way back a rule refuses (its url now another live item's, a file
// gone) is named apart and the rest land, and its set stays undoable, since the file or the address
// can come back; when nothing lands the rule's refusal is the answer. A set of which only
// kept items remain stays undoable too, since the edit since can go, and when no set moved no write
// of its own is made.

import { compareText } from "@repo/contract/library/order-key";
import { z } from "zod";

import type { TurnUndone } from "../note/note-wire";
import { askFill } from "./cell-fills";
import { landItem } from "./cell-landing";
import type { LandingScope } from "./cell-landing";
import { bodyInNote, landProjection } from "./cell-notes";
import { readFieldsPart } from "./cell-parts";
import { refuse, RefusedWriteError } from "./cell-refusal";
import type { CellRefusal } from "./cell-refusal";
import type { CellStorage } from "./cell-storage";
import { sealChangeSet } from "./change-sets";
import { readLiveItem } from "./library-queries";
import { chunkStatement } from "./library-sql";
import type { SqlStatements } from "./library-sql";
import { revertChangeSets } from "./revert-change";
import type { FillChange, ItemChange, ItemNow } from "./revert-change";

export interface UndoAnswer {
  // null: no item went back and no set was undone, so no undo was made
  readonly changeSetId: string | null;
  readonly kept: readonly string[];
  readonly refused: readonly string[];
  readonly reverted: readonly string[];
  // the items whose undo took text someone wrote inside a block an undone turn added
  readonly lostText: readonly string[];
}

const setRowSchema = z.object({
  actor: z.string(),
  id: z.string(),
  opened_at: z.number(),
  sealed_at: z.number().nullable(),
  undone_by: z.string().nullable(),
});

type SetRow = z.infer<typeof setRowSchema>;

const setItemSchema = z.object({
  after_fields: z.string().nullable(),
  before_fields: z.string().nullable(),
  item_id: z.string(),
});

const loadSets = (sql: SqlStatements, ids: readonly string[]): SetRow[] => {
  const rows: SetRow[] = [];
  for (const statement of chunkStatement({
    each: "?",
    head: "SELECT id, actor, opened_at, sealed_at, undone_by FROM change_sets WHERE id IN (",
    rows: [...new Set(ids)].map((id) => [id]),
    separator: ", ",
    tail: ")",
  })) {
    rows.push(...sql.all(statement.sql, statement.params).map((row) => setRowSchema.parse(row)));
  }
  return rows;
};

// the sets asked for, newest first; refuses an id no set has, and a set already undone
const undoableSets = (sql: SqlStatements, ids: readonly string[]): SetRow[] => {
  const sets = loadSets(sql, ids);
  if (sets.length !== new Set(ids).size) {
    refuse({ kind: "not-found" });
  }
  for (const set of sets) {
    if (set.undone_by !== null) {
      refuse({ changeSetId: set.id, kind: "already-undone", undoneBy: set.undone_by });
    }
  }
  return sets.toSorted((a, b) => b.opened_at - a.opened_at || compareText(b.id, a.id));
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

const setItems = (sql: SqlStatements, setId: string) =>
  sql
    .all(
      "SELECT item_id, before_fields, after_fields FROM change_set_items WHERE change_set_id = ?",
      [setId],
    )
    .map((raw) => setItemSchema.parse(raw));

const changesOf = (sql: SqlStatements, setId: string): Map<string, ItemChange> => {
  const changes = new Map<string, ItemChange>();
  for (const row of setItems(sql, setId)) {
    if (row.after_fields === null) {
      continue;
    }
    const after = readFieldsPart(sql, row.item_id, row.after_fields);
    changes.set(
      row.item_id,
      row.before_fields === null
        ? { after, before: null, fills: fillsOf(sql, row.item_id) }
        : { after, before: readFieldsPart(sql, row.item_id, row.before_fields) },
    );
  }
  return changes;
};

// a note an agent's set wrote in, which the undo asks to take that set's edits back
export interface NoteToUndo {
  readonly setId: string;
  readonly itemId: string;
}

// What an undo asks of notes before its write, newest set first: each item an agent's set touched
// whose body is its note's. A person's sets are field writes alone, so they ask nothing.
export const planUndo = (storage: CellStorage, changeSetIds: readonly string[]): NoteToUndo[] =>
  undoableSets(storage, changeSetIds)
    .filter((set) => set.actor === "agent")
    .flatMap((set) =>
      setItems(storage, set.id).flatMap((row) => {
        const item = readLiveItem(storage.db, row.item_id);
        return item !== null && bodyInNote(item) ? [{ itemId: row.item_id, setId: set.id }] : [];
      }),
    );

// what the notes answered, an item's answers taken together: its text lost by any, anyone else's
// writing there, and its body after the last
export const mergeTurnUndos = (
  answers: readonly { readonly itemId: string; readonly undone: TurnUndone }[],
): Map<string, TurnUndone> => {
  const merged = new Map<string, TurnUndone>();
  for (const { itemId, undone } of answers) {
    const held = merged.get(itemId);
    merged.set(itemId, {
      lostText: undone.lostText || (held?.lostText ?? false),
      personEdited: undone.personEdited || (held?.personEdited ?? false),
      projection: undone.projection ?? held?.projection ?? null,
    });
  }
  return merged;
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
  notes: ReadonlyMap<string, TurnUndone>,
): UndoAnswer => {
  const { now, storage } = scope;
  const sets = undoableSets(storage, changeSetIds);
  // a set still open closes first, so what it did is fixed
  for (const set of sets) {
    if (set.sealed_at === null) {
      sealChangeSet(storage, set.id, now);
    }
  }
  const ordered = sets.map((set) => ({ id: set.id, items: changesOf(storage, set.id) }));
  const items = new Map<string, ItemNow | null>();
  for (const set of ordered) {
    for (const itemId of set.items.keys()) {
      if (!items.has(itemId)) {
        const item = readLiveItem(storage.db, itemId);
        items.set(
          itemId,
          item === null
            ? null
            : { bodyEdited: notes.get(itemId)?.personEdited ?? false, fields: item.fields },
        );
      }
    }
  }
  const verdict = revertChangeSets({ at: now, now: items, sets: ordered });
  const kept = new Set(verdict.kept.map((entry) => entry.itemId));
  const reverted = new Set<string>();
  const refused = new Map<string, CellRefusal>();
  for (const [itemId, undone] of notes) {
    if (
      undone.projection !== null &&
      landProjection(scope, itemId, undone.projection) === "landed"
    ) {
      reverted.add(itemId);
    }
  }
  for (const [itemId, undo] of verdict.items) {
    const before = readLiveItem(storage.db, itemId);
    if (before === null) {
      kept.add(itemId);
      continue;
    }
    try {
      const landed = landItem(scope, { before, fields: undo.now.fields, itemId, seed: null });
      // no turn to hold it for: the built-in agent has no undo
      askFill(scope, landed);
      reverted.add(itemId);
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
  const moved = reverted.size > 0 || settled.length > 0;
  if (first !== undefined && !moved) {
    refuse(first);
  }
  return {
    changeSetId: moved ? markUndone(scope, settled) : null,
    kept: [...kept].filter((id) => !refused.has(id)).toSorted(),
    lostText: [...notes]
      .filter(([, undone]) => undone.lostText)
      .map(([itemId]) => itemId)
      .toSorted(),
    refused: [...refused.keys()].toSorted(),
    reverted: [...reverted].toSorted(),
  };
};
