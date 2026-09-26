// A deleted note's comment store goes with it, so nothing leaks under `.inteligir/`, and the
// server and the phone both ask this one rule which stores a delete takes. A byte copy carries the
// `id:` line along, so a store whose id a note that stays still carries stays too. An owner the
// caller has not seen yet goes unnamed, so the rule never takes more than an unguarded delete would.

import { commentsStorePath, isNoteIdKey } from "./sidecar-schema";

export interface RemovedDoc {
  path: string;
  // its frontmatter id; null when it has none
  noteId: string | null;
}

// `owners` answers every path that carries an id, the removed docs' own included
export const commentStoresFreedBy = (
  removedDocs: readonly RemovedDoc[],
  owners: (noteId: string) => readonly string[],
): string[] => {
  const removed = new Set(removedDocs.map((doc) => doc.path));
  const ids = new Set(
    removedDocs.flatMap((doc) =>
      doc.noteId !== null && isNoteIdKey(doc.noteId) ? [doc.noteId] : [],
    ),
  );
  return [...ids]
    .filter((id) => owners(id).every((owner) => removed.has(owner)))
    .map(commentsStorePath);
};
