export interface RankableWikiTarget {
  readonly title: string;
}

const fold = (text: string): string =>
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
const tierOf = (
  target: RankableWikiTarget,
  needle: string,
  words: readonly string[],
): number | null => {
  const title = fold(target.title);
  if (title.startsWith(needle)) {
    return 0;
  }
  if (words.every((word) => hasWordStart(title, word))) {
    return 1;
  }
  return title.includes(needle) ? 2 : null;
};

// Every target the query matches, case- and accent-blind, best first; a tie keeps the listing's
// order. A blank query matches every target, in order.
export const rankWikiTargets = <T extends RankableWikiTarget>(
  targets: readonly T[],
  query: string,
): T[] => {
  const needle = fold(query.trim());
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
