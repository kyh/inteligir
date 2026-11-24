export interface FoldedTitle {
  readonly folded: string;
}

export const foldTitle = (text: string) =>
  text
    .normalize("NFD")
    .replaceAll(/\p{Mn}+/gu, "")
    .toLowerCase();

const WORD_CHAR = /[\p{L}\p{N}]/u;

const hasWordStart = (text: string, word: string) => {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (at === 0 || !WORD_CHAR.test(text.charAt(at - 1))) {
      return true;
    }
  }

  return false;
};

const tierOf = (target: FoldedTitle, needle: string, words: readonly string[]) => {
  const title = target.folded;

  if (title.startsWith(needle)) {
    return 0;
  }

  if (words.every((word) => hasWordStart(title, word))) {
    return 1;
  }

  return title.includes(needle) ? 2 : null;
};

export const rankTitles = <T extends FoldedTitle>(targets: readonly T[], query: string) => {
  const needle = foldTitle(query.trim());

  if (needle === "") {
    return [...targets] satisfies T[];
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
