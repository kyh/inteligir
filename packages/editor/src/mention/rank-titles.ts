export interface FoldedTitle {
  // the title case- and accent-blind, as `foldTitle` reads it
  readonly folded: string;
}

export const foldTitle = (text: string): string =>
  text
    .normalize("NFD")
    .replaceAll(/\p{Mn}+/gu, "")
    .toLowerCase();

const WORD_CHAR = /[\p{L}\p{N}]/u;

const hasWordStart = (text: string, word: string): boolean => {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (at === 0 || !WORD_CHAR.test(text.charAt(at - 1))) {
      return true;
    }
  }
  return false;
};

// Lower ranks first: the title starting with what was typed, every typed word starting a word of
// it, then a hit mid-word.
const tierOf = (target: FoldedTitle, needle: string, words: readonly string[]): number | null => {
  const title = target.folded;
  if (title.startsWith(needle)) {
    return 0;
  }
  if (words.every((word) => hasWordStart(title, word))) {
    return 1;
  }
  return title.includes(needle) ? 2 : null;
};

// Every title the query matches, case- and accent-blind, best first; a tie keeps the listing's
// order. A blank query matches every title, in order.
export const rankTitles = <T extends FoldedTitle>(targets: readonly T[], query: string): T[] => {
  const needle = foldTitle(query.trim());
  if (needle === "") {
    return [...targets];
  }
  const words = needle.split(/\s+/u);
  return targets
    .flatMap((target) => {
      const tier = tierOf(target, needle, words);
      return tier === null ? [] : [{ target, tier }];
    })
    .toSorted((a, b) => a.tier - b.tier)
    .map(({ target }) => target);
};
