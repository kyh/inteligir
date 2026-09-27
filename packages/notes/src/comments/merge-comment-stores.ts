// Entry by entry, never as text: two devices each adding a comment both touch the store's closing
// brace, so a line merge calls every pair of appends an overlap.

import {
  commentEntriesOf,
  parseSidecar,
  sameCommentEntry,
  serializeSidecar,
} from "./sidecar-schema";
import type { CommentEntry, CommentSidecar } from "./sidecar-schema";

// `unreadable`: a side does not parse, and the caller keeps mine. Folding it to {} would read as
// "every comment deleted" and erase the other side's threads.
export type CommentStoreMerge =
  | { readonly kind: "merged"; readonly text: string }
  | { readonly kind: "unreadable" };

export interface CommentStoreSides {
  // null: no common ancestor, so nothing reads as deleted
  readonly base: string | null;
  readonly mine: string;
  readonly theirs: string;
}

const mergeEntry = (
  base: CommentEntry | undefined,
  mine: CommentEntry | undefined,
  theirs: CommentEntry | undefined,
): CommentEntry | undefined => {
  if (mine === undefined) {
    return sameCommentEntry(base, theirs) ? undefined : theirs;
  }
  if (theirs === undefined) {
    return sameCommentEntry(base, mine) ? undefined : mine;
  }
  if (sameCommentEntry(base, mine)) {
    return theirs;
  }
  if (sameCommentEntry(base, theirs)) {
    return mine;
  }
  return theirs.updatedAt > mine.updatedAt ? theirs : mine;
};

const sameSidecar = (a: CommentSidecar, b: CommentSidecar): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// Union by id; both edited → the later `updatedAt`, a tie keeps mine; deleted beside untouched →
// gone; deleted beside edited → kept. A reply one side added keeps the parents the other deleted,
// so a thread someone answered is not left as a stray.
export const mergeCommentStores = ({
  base,
  mine,
  theirs,
}: CommentStoreSides): CommentStoreMerge => {
  const mineParse = parseSidecar(mine);
  const theirsParse = parseSidecar(theirs);
  if (!mineParse.ok || !theirsParse.ok) {
    return { kind: "unreadable" };
  }
  const baseParse = base === null ? null : parseSidecar(base);
  const baseEntries = commentEntriesOf(baseParse?.ok === true ? baseParse.sidecar : null);
  const mineEntries = commentEntriesOf(mineParse.sidecar);
  const theirsEntries = commentEntriesOf(theirsParse.sidecar);
  // mine's order, then theirs' new ids: insertion order is the store's thread order
  const ids = new Set([...mineEntries.keys(), ...theirsEntries.keys()]);

  const merged = new Map<string, CommentEntry>();
  for (const id of ids) {
    const entry = mergeEntry(baseEntries.get(id), mineEntries.get(id), theirsEntries.get(id));
    if (entry !== undefined) {
      merged.set(id, entry);
    }
  }
  for (const { parentId } of merged.values()) {
    let missing = parentId;
    while (missing !== undefined && !merged.has(missing)) {
      const parent = mineEntries.get(missing) ?? theirsEntries.get(missing);
      if (parent === undefined) {
        break;
      }
      merged.set(missing, parent);
      missing = parent.parentId;
    }
  }

  const ordered: [string, CommentEntry][] = [];
  for (const id of ids) {
    const entry = merged.get(id);
    if (entry !== undefined) {
      ordered.push([id, entry]);
    }
  }
  const result: CommentSidecar = Object.fromEntries(ordered);
  if (sameSidecar(result, mineParse.sidecar)) {
    return { kind: "merged", text: mine };
  }
  if (sameSidecar(result, theirsParse.sidecar)) {
    return { kind: "merged", text: theirs };
  }
  return { kind: "merged", text: serializeSidecar(result) };
};
