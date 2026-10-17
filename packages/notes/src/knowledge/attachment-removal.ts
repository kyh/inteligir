// A deleted doc takes with it the files only it links: an item's original, its cover and its page
// copy go with the item, and a file another doc still embeds or links stays. The server's delete and
// the phone's both ask this one rule. A file whose linkers the caller has not seen is kept, so the
// rule never takes more than the delete named.

import { isDocPath, isVaultMetadataPath } from "./doc-file";

export interface RemovedLinker {
  path: string;
  // the files that are not docs it links or embeds
  linked: readonly string[];
}

// `linkersOf` answers every doc that links or embeds the file, the removed ones included. A file
// goes when every linker is being removed. One whose linkers do not even hold the removed doc that
// links it is a file the caller's graph has not read (a doc whose text has not arrived), so it is
// kept, as is any doc or dot-path a caller named among the linked: a note is never an attachment,
// and the app's own stores leave by their own rule.
export const attachmentsFreedBy = (
  removed: readonly RemovedLinker[],
  linkersOf: (file: string) => readonly string[],
): string[] => {
  const removing = new Set(removed.map((doc) => doc.path));
  const freed: string[] = [];
  const judged = new Set<string>();
  for (const doc of removed) {
    for (const file of doc.linked) {
      if (judged.has(file) || isDocPath(file) || isVaultMetadataPath(file)) {
        continue;
      }
      judged.add(file);
      const linkers = linkersOf(file);
      if (linkers.includes(doc.path) && linkers.every((linker) => removing.has(linker))) {
        freed.push(file);
      }
    }
  }
  return freed;
};
