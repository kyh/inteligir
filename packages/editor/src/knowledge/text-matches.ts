// Literal occurrences, not the search engine's tokens: FTS5 cannot answer where inside a
// line a hit sits, and a jump must land on exactly the bytes the row showed. One matcher
// serves the listing and the find bar, so the two cannot disagree.

export interface TextMatchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

// offset is the utf-16 offset into the text searched
export interface TextOffset {
  offset: number;
  length: number;
}

const EXCERPT_BEFORE = 40;
const EXCERPT_AFTER = 80;
const ELLIPSIS = "…";

const escapeRegExp = (needle: string): string => needle.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const wholeWord = (pattern: string): string =>
  `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;

// the `i` flag under `u` folds case the unicode way, so offsets stay those of the original text
const matcher = (needle: string, options: TextMatchOptions): RegExp => {
  const literal = escapeRegExp(needle);
  return new RegExp(
    options.wholeWord ? wholeWord(literal) : literal,
    options.caseSensitive ? "gu" : "giu",
  );
};

const hitsIn = (pattern: RegExp, text: string): TextOffset[] => {
  pattern.lastIndex = 0;
  const found: TextOffset[] = [];
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    found.push({ length: hit[0].length, offset: hit.index });
  }
  return found;
};

export const findTextOffsets = (
  text: string,
  needle: string,
  options: TextMatchOptions,
): TextOffset[] => (needle === "" ? [] : hitsIn(matcher(needle, options), text));

// a match's line clipped around it, as a listing row shows it
export interface MatchExcerpt {
  before: string;
  text: string;
  after: string;
}

export const excerptAround = (line: string, match: TextOffset): MatchExcerpt => {
  const start = match.offset;
  const end = start + match.length;
  const from = Math.max(0, start - EXCERPT_BEFORE);
  const to = Math.min(line.length, end + EXCERPT_AFTER);
  return {
    after: `${line.slice(end, to)}${to < line.length ? ELLIPSIS : ""}`,
    before: `${from > 0 ? ELLIPSIS : ""}${line.slice(from, start)}`,
    text: line.slice(start, end),
  };
};

const PRINTABLE_ASCII = /^[\u0020-\u007E]+$/u;

// the needles SQLite's case fold reads as this matcher does, each on one line
export const isPrintableAscii = (needle: string): boolean => PRINTABLE_ASCII.test(needle);
