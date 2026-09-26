// Takes one writer's change to a comment store back entry by entry, never as text: a line merge
// over the store's json can leave it unparseable. An entry is the unit, so a thread someone
// answered since stays whole while the writer's untouched ones go. Sidecars in, the store to
// write out: the caller reads the three versions and lands it through its own compare-and-swap.

import { sameCommentEntry } from "./sidecar-schema";
import type { CommentEntry, CommentSidecar } from "./sidecar-schema";

export interface CommentEntriesRevertInput {
  // null: no store at that point
  readonly before: CommentSidecar | null;
  readonly after: CommentSidecar | null;
  readonly current: CommentSidecar | null;
  // every id a marker in the store's note carries once the note's own revert has landed; null
  // when the note does not parse, so no marker can be called gone
  readonly markerIds: ReadonlySet<string> | null;
}

// `kept`: an entry the change made or edited is left as it is now, because it was edited,
// answered or anchored since, or its thread is gone.
export type CommentEntriesRevert =
  | { readonly kind: "unchanged"; readonly kept: boolean }
  // `sidecar` null: no entry is left, so the store goes
  | { readonly kind: "reverted"; readonly sidecar: CommentSidecar | null; readonly kept: boolean };

type Entries = ReadonlyMap<string, CommentEntry>;

// a Map, not the record: `__proto__` is a legal comment id
const entriesOf = (sidecar: CommentSidecar | null): Entries =>
  new Map(Object.entries(sidecar ?? {}));

const sameSide = (a: CommentEntry | undefined, b: CommentEntry | undefined): boolean =>
  a === undefined || b === undefined ? a === b : sameCommentEntry(a, b);

interface Moves {
  // ids the change added, to go
  readonly removed: Set<string>;
  // entries as they were before the change, to come back
  readonly restored: Map<string, CommentEntry>;
  kept: boolean;
}

const movesOf = (
  before: Entries,
  after: Entries,
  current: Entries,
  markerIds: ReadonlySet<string> | null,
): Moves => {
  const moves: Moves = { kept: false, removed: new Set(), restored: new Map() };
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(id);
    const made = after.get(id);
    const now = current.get(id);
    if (sameSide(was, made)) {
      continue;
    }
    if (!sameSide(now, made)) {
      // an entry the change added and someone deleted since is already where the undo takes it
      moves.kept ||= was !== undefined || now !== undefined;
    } else if (was !== undefined) {
      moves.restored.set(id, was);
    } else if (markerIds === null || markerIds.has(id)) {
      moves.kept = true;
    } else {
      moves.removed.add(id);
    }
  }
  return moves;
};

const heldEntry = (current: Entries, moves: Moves, id: string): CommentEntry | undefined =>
  moves.restored.get(id) ?? (moves.removed.has(id) ? undefined : current.get(id));

// a reply left in place keeps the entry it answers, and a reply the change deleted stays gone
// once its parent is. answers whether it dropped a move, since a dropped one can strand another.
const dropStranded = (current: Entries, moves: Moves): boolean => {
  const parents = new Set<string>();
  for (const id of new Set([...current.keys(), ...moves.restored.keys()])) {
    const parentId = heldEntry(current, moves, id)?.parentId;
    if (parentId !== undefined) {
      parents.add(parentId);
    }
  }
  let dropped = false;
  for (const id of moves.removed) {
    if (parents.has(id)) {
      moves.removed.delete(id);
      dropped = true;
    }
  }
  for (const [id, entry] of moves.restored) {
    if (entry.parentId !== undefined && heldEntry(current, moves, entry.parentId) === undefined) {
      moves.restored.delete(id);
      dropped = true;
    }
  }
  return dropped;
};

// the store's order is its thread order: what is there now keeps its place, and an entry brought
// back follows it
const sidecarAfter = (current: Entries, moves: Moves): CommentSidecar | null => {
  const ordered: [string, CommentEntry][] = [];
  for (const [id, entry] of current) {
    if (!moves.removed.has(id)) {
      ordered.push([id, moves.restored.get(id) ?? entry]);
    }
  }
  for (const [id, entry] of moves.restored) {
    if (!current.has(id)) {
      ordered.push([id, entry]);
    }
  }
  return ordered.length === 0 ? null : Object.fromEntries(ordered);
};

// An entry the change added goes when it is still as the change left it, nothing stands under it
// and no marker anchors it; an entry the change edited or deleted comes back as it was when it is
// still as the change left it, and a deleted reply only under a parent that is there. Anything
// else is left as it is now.
export const revertCommentEntries = (input: CommentEntriesRevertInput): CommentEntriesRevert => {
  const current = entriesOf(input.current);
  const moves = movesOf(entriesOf(input.before), entriesOf(input.after), current, input.markerIds);
  while (dropStranded(current, moves)) {
    moves.kept = true;
  }
  if (moves.removed.size === 0 && moves.restored.size === 0) {
    return { kept: moves.kept, kind: "unchanged" };
  }
  return { kept: moves.kept, kind: "reverted", sidecar: sidecarAfter(current, moves) };
};
