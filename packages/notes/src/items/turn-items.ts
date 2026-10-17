// what an agent's turn changed, as a person counts it: one entry per item. A turn's paths are
// every file its commit touched, so a move is the path it left and the path it made, and a save
// writes the item beside its cover, its original or its page copy; counted as paths, Tidy my
// library's ten moves read as twenty items and one saved link as two. The toast, a reply's footer
// and the undo's own sentence all count through this one rule.

import { isDocPath, isVaultMetadataPath } from "../knowledge/doc-file";
import { basenamePath, vaultCollisionKey } from "../knowledge/vault-path";

// how the path ended up across the turn; null when the caller cannot say (an undo's answer)
export interface TurnPathChange {
  path: string;
  change: "added" | "modified" | "deleted" | null;
}

const nameOf = (path: string): string => vaultCollisionKey(basenamePath(path));

// the doc paths with each move folded into the one path it made: a doc removed and a doc made under
// the same name are one item that moved. With no change to go by, two paths under one name are
// the two ends of one move
const foldMoves = (docs: readonly TurnPathChange[]): string[] => {
  const known = docs.every((doc) => doc.change !== null);
  if (!known) {
    const seen = new Set<string>();
    return docs.flatMap((doc) => {
      const name = nameOf(doc.path);
      if (seen.has(name)) {
        return [];
      }
      seen.add(name);
      return [doc.path];
    });
  }
  const removed = new Map<string, number>();
  for (const doc of docs) {
    if (doc.change === "deleted") {
      removed.set(nameOf(doc.path), (removed.get(nameOf(doc.path)) ?? 0) + 1);
    }
  }
  // each made doc that pairs with a removed one takes that removal with it
  const paired = new Map<string, number>();
  for (const doc of docs) {
    const name = nameOf(doc.path);
    if (doc.change === "added" && (paired.get(name) ?? 0) < (removed.get(name) ?? 0)) {
      paired.set(name, (paired.get(name) ?? 0) + 1);
    }
  }
  return docs.flatMap((doc) => {
    if (doc.change !== "deleted") {
      return [doc.path];
    }
    const name = nameOf(doc.path);
    const left = paired.get(name) ?? 0;
    if (left > 0) {
      paired.set(name, left - 1);
      return [];
    }
    return [doc.path];
  });
};

// the paths a person reads as the items a turn changed: its notes and items, each move once at the
// path it made, and the files beside them (covers, originals, page copies) left to ride the item
// that holds them; a turn that changed files alone names those files. Dot-paths never count
export const turnItemPaths = (changes: readonly TurnPathChange[]): string[] => {
  const visible = changes.filter((change) => !isVaultMetadataPath(change.path));
  const docs = visible.filter((change) => isDocPath(change.path));
  return docs.length === 0 ? visible.map((change) => change.path) : foldMoves(docs);
};
