import { docStem } from "./doc-file";

export interface RankableWikiTarget {
  readonly path: string;
  readonly title: string;
  readonly aliases?: readonly string[] | undefined;
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

// Lower ranks first. The stem is what a picked link spells, so a hit there beats the title,
// which beats an alias; every typed word starting a word of those names beats a hit mid-word,
// and a hit in the folder part of the path only qualifies the row.
const tierOf = (
  target: RankableWikiTarget,
  needle: string,
  words: readonly string[],
): number | null => {
  const stem = fold(docStem(target.path));
  const title = fold(target.title);
  const aliases = (target.aliases ?? []).map(fold);
  if (stem.startsWith(needle)) {
    return 0;
  }
  if (title.startsWith(needle)) {
    return 1;
  }
  if (aliases.some((alias) => alias.startsWith(needle))) {
    return 2;
  }
  const names = [stem, title, ...aliases];
  if (words.every((word) => names.some((name) => hasWordStart(name, word)))) {
    return 3;
  }
  if ([fold(target.path), title, ...aliases].some((text) => text.includes(needle))) {
    return 4;
  }
  return null;
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
