// Entry by entry, never as text: two devices each adding an annotation both touch the store's closing
// brace, so a line merge calls every pair of appends an overlap.

import {
  annotationEntriesOf,
  parseAnnotationStore,
  sameAnnotationEntry,
  serializeAnnotationStore,
} from "./store-schema";
import type { AnnotationEntry, AnnotationStore } from "./store-schema";

// `unreadable`: a side does not parse, and the caller keeps mine. Folding it to {} would read as
// "every annotation deleted" and erase the other side's.
export type AnnotationStoreMerge =
  | { readonly kind: "merged"; readonly text: string }
  | { readonly kind: "unreadable" };

export interface AnnotationStoreSides {
  // null: no common ancestor, so nothing reads as deleted
  readonly base: string | null;
  readonly mine: string;
  readonly theirs: string;
}

const mergeEntry = (
  base: AnnotationEntry | undefined,
  mine: AnnotationEntry | undefined,
  theirs: AnnotationEntry | undefined,
): AnnotationEntry | undefined => {
  if (mine === undefined) {
    return sameAnnotationEntry(base, theirs) ? undefined : theirs;
  }
  if (theirs === undefined) {
    return sameAnnotationEntry(base, mine) ? undefined : mine;
  }
  if (sameAnnotationEntry(base, mine)) {
    return theirs;
  }
  if (sameAnnotationEntry(base, theirs)) {
    return mine;
  }
  return theirs.updatedAt > mine.updatedAt ? theirs : mine;
};

const sameStore = (a: AnnotationStore, b: AnnotationStore): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// Union by id; both edited → the later `updatedAt`, a tie keeps mine; deleted beside untouched →
// gone; deleted beside edited → kept. A reply one side added keeps the parents the other deleted,
// so a thread someone answered is not left as a stray.
export const mergeAnnotationStores = ({
  base,
  mine,
  theirs,
}: AnnotationStoreSides): AnnotationStoreMerge => {
  const mineParse = parseAnnotationStore(mine);
  const theirsParse = parseAnnotationStore(theirs);
  if (!mineParse.ok || !theirsParse.ok) {
    return { kind: "unreadable" };
  }
  const baseParse = base === null ? null : parseAnnotationStore(base);
  const baseEntries = annotationEntriesOf(baseParse?.ok === true ? baseParse.store : null);
  const mineEntries = annotationEntriesOf(mineParse.store);
  const theirsEntries = annotationEntriesOf(theirsParse.store);
  // mine's order, then theirs' new ids: insertion order is the store's thread order
  const ids = new Set([...mineEntries.keys(), ...theirsEntries.keys()]);

  const merged = new Map<string, AnnotationEntry>();
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

  const ordered: [string, AnnotationEntry][] = [];
  for (const id of ids) {
    const entry = merged.get(id);
    if (entry !== undefined) {
      ordered.push([id, entry]);
    }
  }
  const result: AnnotationStore = Object.fromEntries(ordered);
  if (sameStore(result, mineParse.store)) {
    return { kind: "merged", text: mine };
  }
  if (sameStore(result, theirsParse.store)) {
    return { kind: "merged", text: theirs };
  }
  return { kind: "merged", text: serializeAnnotationStore(result) };
};
