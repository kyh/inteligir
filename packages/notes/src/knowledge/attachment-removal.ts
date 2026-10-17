// A deleted doc takes with it the files only it links: an item's original, its cover and its page
// copy go with the item, and a file another doc still embeds or links stays. The server's delete and
// the phone's both ask this one rule. A file whose linkers the caller has not seen is kept, so the
// rule never takes more than the delete named.

export interface RemovedLinker {
  path: string;
  // the files that are not docs it links or embeds
  linked: readonly string[];
}

// `linkersOf` answers every doc that links or embeds the file, the removed ones included
// PIVOT-STUB(S2): frees nothing until a delete takes what only it links (§2.12)
export const attachmentsFreedBy = (
  _removed: readonly RemovedLinker[],
  _linkersOf: (file: string) => readonly string[],
): string[] => [];
