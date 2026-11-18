export interface TextMatchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface TextOffset {
  offset: number;
  length: number;
}

const escapeRegExp = (needle: string) => needle.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const wholeWord = (pattern: string) => `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;

const matcher = (needle: string, options: TextMatchOptions) => {
  const literal = escapeRegExp(needle);

  return new RegExp(
    options.wholeWord ? wholeWord(literal) : literal,
    options.caseSensitive ? "gu" : "giu",
  ) satisfies RegExp;
};

const hitsIn = (pattern: RegExp, text: string) => {
  pattern.lastIndex = 0;
  const found: TextOffset[] = [];

  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    found.push({ length: hit[0].length, offset: hit.index });
  }

  return found;
};

export const findTextOffsets = (text: string, needle: string, options: TextMatchOptions) =>
  (needle === "" ? [] : hitsIn(matcher(needle, options), text)) satisfies TextOffset[];
