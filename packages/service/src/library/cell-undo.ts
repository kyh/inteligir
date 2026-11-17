// Undo takes back what a thread's ended turns changed, in one write: one turn's change set, or the
// conversation's, newest first, so many turns a call. Each set's entry for an item is landed by
// `./revert-change` on the item as the newer sets' undo left it, so an item someone changed since
// stays whole and is named. What a set did to a note's body its note undoes first, outside any
// transaction: `planUndo` picks the sets and names those notes, and the write takes back those
// same sets, landing what each note answered (its body after, whether the undo took someone's
// text, whether anyone but an agent wrote there). An entry the write settled goes, so a set holds
// only what is left to take back and a turn undone twice has nothing left. An item kept stays, since
// the edit since can go, and so does one whose way back a rule refuses (its url now another live
// item's, a file gone), since the file or the address can come back; when a rule held back all
// that could land, its refusal is the answer.

import { and, asc, desc, eq, exists, isNotNull, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import { changeSetItems, changeSets } from "@repo/db/cell/schema";

import type { TurnUndone } from "../note/note-wire";
import { bodyWriter } from "./cell-body";
import type { CellDb } from "./cell-db";
import { askFill } from "./cell-fills";
import { landItem } from "./cell-landing";
import type { ItemScope } from "./cell-landing";
import { landProjection } from "./cell-notes";
import { refuse, RefusedWriteError } from "./cell-refusal";
import type { CellRefusal } from "./cell-refusal";
import { dropEntry, ENTRY_COLUMNS, entryOf } from "./change-sets";
import { readItem } from "./library-queries";
import { revertChangeSets } from "./revert-change";
import type { ItemNow, SetEntry } from "./revert-change";

// the turns one undo takes back, which holds a call to the notes that many turns wrote in; a
// conversation of more goes a lot a call
export const UNDO_TURNS_MAX = 50;

// which of a thread's turns an undo takes back: one, or the conversation's before `before`
export type UndoTarget =
  | { readonly threadId: string; readonly turn: number }
  | { readonly threadId: string; readonly before?: number | undefined };

export const undoneSchema = z.object({
  kept: z.array(z.string()),
  // the items whose undo took text someone wrote inside a block an undone turn added
  lostText: z.array(z.string()),
  // where the conversation's turns this undo left start, null when none wait
  next: z.number().nullable(),
  refused: z.array(z.string()),
  reverted: z.array(z.string()),
});

// a set Undo takes back: its turn ended, and something of it is left
const undoable = (db: CellDb, threadId: string): SQL | undefined =>
  and(
    eq(changeSets.threadId, threadId),
    isNotNull(changeSets.sealedAt),
    exists(
      db
        .select({ id: changeSetItems.changeSetId })
        .from(changeSetItems)
        .where(eq(changeSetItems.changeSetId, changeSets.id)),
    ),
  );

const turnsOf = (target: UndoTarget): SQL | undefined => {
  if ("turn" in target) {
    return eq(changeSets.turn, target.turn);
  }
  return target.before === undefined ? undefined : lt(changeSets.turn, target.before);
};

// the thread's turns Undo can still take back, oldest first
export const undoableTurns = (db: CellDb, threadId: string): number[] =>
  db
    .select({ turn: changeSets.turn })
    .from(changeSets)
    .where(undoable(db, threadId))
    .orderBy(asc(changeSets.turn))
    .all()
    .map(({ turn }) => turn);

const setItems = (db: CellDb, setId: string) =>
  db
    .select({ ...ENTRY_COLUMNS, itemId: changeSetItems.itemId })
    .from(changeSetItems)
    .where(eq(changeSetItems.changeSetId, setId))
    .all();

const entriesOf = (db: CellDb, setId: string): Map<string, SetEntry> =>
  new Map(setItems(db, setId).map(({ itemId, ...row }) => [itemId, entryOf(row)]));

// a note a set wrote in, which the undo asks to take that set's edits back
interface NoteToUndo {
  readonly setId: string;
  readonly itemId: string;
}

// What an undo takes back, picked before its notes are asked: the sets by id, newest first, which
// the write then lands whatever sealed meanwhile, and each item one touched whose body is its
// note's
export interface UndoPlan {
  readonly threadId: string;
  readonly setIds: readonly string[];
  readonly notes: readonly NoteToUndo[];
  readonly next: number | null;
}

export const planUndo = (db: CellDb, target: UndoTarget): UndoPlan => {
  const waiting = db
    .select({ id: changeSets.id, turn: changeSets.turn })
    .from(changeSets)
    .where(and(undoable(db, target.threadId), turnsOf(target)))
    .orderBy(desc(changeSets.turn))
    .limit(UNDO_TURNS_MAX + 1)
    .all();
  const sets = waiting.slice(0, UNDO_TURNS_MAX);
  return {
    // a lot all kept or refused stays undoable, so the next lot starts below this one, never at it
    next: waiting.length > sets.length ? (sets.at(-1)?.turn ?? null) : null,
    notes: sets.flatMap((set) =>
      setItems(db, set.id).flatMap(({ itemId }) => {
        const item = readItem(db, itemId);
        return item !== null && bodyWriter(item.body.home) === "note"
          ? [{ itemId, setId: set.id }]
          : [];
      }),
    ),
    setIds: sets.map((set) => set.id),
    threadId: target.threadId,
  };
};

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

interface SetEntries {
  readonly id: string;
  readonly items: ReadonlyMap<string, SetEntry>;
}

// each item the sets touched as it is now, null once it is gone
const itemsNow = (
  db: CellDb,
  sets: readonly SetEntries[],
  notes: ReadonlyMap<string, TurnUndone>,
): Map<string, ItemNow | null> => {
  const items = new Map<string, ItemNow | null>();
  for (const itemId of sets.flatMap((set) => [...set.items.keys()])) {
    if (!items.has(itemId)) {
      const item = readItem(db, itemId);
      items.set(
        itemId,
        item === null
          ? null
          : { bodyEdited: notes.get(itemId)?.personEdited ?? false, fields: item.fields },
      );
    }
  }
  return items;
};

export const undoChangeSets = (
  scope: ItemScope,
  plan: UndoPlan,
  notes: ReadonlyMap<string, TurnUndone>,
): z.input<typeof undoneSchema> => {
  const { db, now } = scope;
  // a set undone or pruned since the plan holds no entry, so it takes nothing back
  const ordered = plan.setIds.map((id) => ({ id, items: entriesOf(db, id) }));
  const verdict = revertChangeSets({ at: now, now: itemsNow(db, ordered, notes), sets: ordered });
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
  for (const [itemId, { fields }] of verdict.items) {
    const before = readItem(db, itemId);
    if (before === null) {
      continue;
    }
    try {
      const landed = landItem(scope, { before, fields, itemId, seed: null });
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
  const [first] = refused.values();
  if (first !== undefined && reverted.size === 0) {
    refuse(first);
  }
  // an entry kept or refused stays to undo again; every other is settled, and goes
  const settled = ordered.flatMap((set) => {
    const kept = new Set(
      verdict.kept.filter((entry) => entry.setId === set.id).map((entry) => entry.itemId),
    );
    return [...set.items.keys()]
      .filter((itemId) => !kept.has(itemId) && !refused.has(itemId))
      .map((itemId) => ({ changeSetId: set.id, itemId }));
  });
  for (const entry of settled) {
    dropEntry(db, entry, now);
  }
  // every device reads the thread's undoable turns again
  if (settled.length > 0) {
    scope.moved.thread(plan.threadId);
  }
  return {
    kept: [...new Set(verdict.kept.map((entry) => entry.itemId))]
      .filter((id) => !refused.has(id))
      .toSorted(),
    lostText: [...notes]
      .filter(([, undone]) => undone.lostText)
      .map(([itemId]) => itemId)
      .toSorted(),
    next: plan.next,
    refused: [...refused.keys()].toSorted(),
    reverted: [...reverted].toSorted(),
  };
};
