// Undo takes sealed turns' change sets back in one write: newest set first, each set's entry for an
// item landed by `./revert-change` on the item as the newer sets' undo left it, so an item someone
// changed since stays whole and is named. What a set did to a note's body its note undoes
// first, outside any transaction (`planUndo` names those notes), and the write lands what each note
// answered: its body after, whether the undo took someone's text, whether anyone but an agent wrote
// there. An item whose way back a rule refuses (its url now another live item's, a file gone) is
// named apart and the rest land, and its set stays undoable, since the file or the address can come
// back; when nothing lands the rule's refusal is the answer. A set of which only kept items remain
// stays undoable too, since the edit since can go.

import { compareText } from "@repo/contract/library/order-key";
import { eq, inArray } from "drizzle-orm";

import { changeSetItems, changeSets } from "@repo/db/cell/schema";

import type { TurnUndone } from "../note/note-wire";
import { bodyWriter } from "./cell-body";
import type { CellDb } from "./cell-db";
import { listChunks } from "./cell-db";
import { askFill } from "./cell-fills";
import { landItem } from "./cell-landing";
import type { LandingScope } from "./cell-landing";
import { landProjection } from "./cell-notes";
import { refuse, RefusedWriteError } from "./cell-refusal";
import type { CellRefusal } from "./cell-refusal";
import { ENTRY_COLUMNS, entryOf } from "./change-sets";
import { readLiveItem } from "./library-queries";
import { revertChangeSets } from "./revert-change";
import type { ItemNow, SetEntry } from "./revert-change";

export interface UndoAnswer {
  readonly kept: readonly string[];
  readonly refused: readonly string[];
  readonly reverted: readonly string[];
  // the items whose undo took text someone wrote inside a block an undone turn added
  readonly lostText: readonly string[];
}

const SET_COLUMNS = {
  id: changeSets.id,
  openedAt: changeSets.openedAt,
  sealedAt: changeSets.sealedAt,
  undoneAt: changeSets.undoneAt,
};

const loadSets = (db: CellDb, ids: readonly string[]) =>
  listChunks([...new Set(ids)]).flatMap((chunk) =>
    db.select(SET_COLUMNS).from(changeSets).where(inArray(changeSets.id, chunk)).all(),
  );

// the sets asked for, newest first; refuses an id no set has, a set already undone, and one whose
// turn is still open, since what it did is not yet fixed
const undoableSets = (db: CellDb, ids: readonly string[]) => {
  const sets = loadSets(db, ids);
  if (sets.length !== new Set(ids).size) {
    refuse({ kind: "not-found" });
  }
  for (const set of sets) {
    if (set.undoneAt !== null) {
      refuse({ changeSetId: set.id, kind: "already-undone" });
    }
    if (set.sealedAt === null) {
      refuse({ kind: "conflict" });
    }
  }
  return sets.toSorted((a, b) => b.openedAt - a.openedAt || compareText(b.id, a.id));
};

const setItems = (db: CellDb, setId: string) =>
  db
    .select({ ...ENTRY_COLUMNS, itemId: changeSetItems.itemId })
    .from(changeSetItems)
    .where(eq(changeSetItems.changeSetId, setId))
    .all();

const entriesOf = (db: CellDb, setId: string): Map<string, SetEntry> =>
  new Map(setItems(db, setId).map(({ itemId, ...row }) => [itemId, entryOf(row)]));

// a note a set wrote in, which the undo asks to take that set's edits back
export interface NoteToUndo {
  readonly setId: string;
  readonly itemId: string;
}

// What an undo asks of notes before its write, newest set first: each item a set touched whose
// body is its note's.
export const planUndo = (db: CellDb, changeSetIds: readonly string[]): NoteToUndo[] =>
  undoableSets(db, changeSetIds).flatMap((set) =>
    setItems(db, set.id).flatMap(({ itemId }) => {
      const item = readLiveItem(db, itemId);
      return item !== null && bodyWriter(item.body.home) === "note"
        ? [{ itemId, setId: set.id }]
        : [];
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

export const undoChangeSets = (
  scope: LandingScope,
  changeSetIds: readonly string[],
  notes: ReadonlyMap<string, TurnUndone>,
): UndoAnswer => {
  const { db, now } = scope;
  const ordered = undoableSets(db, changeSetIds).map((set) => ({
    id: set.id,
    items: entriesOf(db, set.id),
  }));
  const items = new Map<string, ItemNow | null>();
  for (const set of ordered) {
    for (const itemId of set.items.keys()) {
      if (!items.has(itemId)) {
        const item = readLiveItem(db, itemId);
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
    const before = readLiveItem(db, itemId);
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
  if (first !== undefined && reverted.size === 0 && settled.length === 0) {
    refuse(first);
  }
  for (const set of settled) {
    db.update(changeSets).set({ undoneAt: now }).where(eq(changeSets.id, set.id)).run();
  }
  return {
    kept: [...kept].filter((id) => !refused.has(id)).toSorted(),
    lostText: [...notes]
      .filter(([, undone]) => undone.lostText)
      .map(([itemId]) => itemId)
      .toSorted(),
    refused: [...refused.keys()].toSorted(),
    reverted: [...reverted].toSorted(),
  };
};
