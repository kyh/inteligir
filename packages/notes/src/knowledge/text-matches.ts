// Literal occurrences, not the search engine's tokens: FTS5 cannot answer where inside a
// line a hit sits, and a replace must touch exactly the bytes the rows showed. One matcher
// serves the listing and the rewrite, so the two cannot disagree.

import { splitLinesKeepingTerminators } from "../text/source-lines";

export interface TextMatchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

// line is 1-based; column is the utf-16 offset inside that line
export interface TextMatch {
  line: number;
  column: number;
  length: number;
}

// offset is the utf-16 offset into the whole string, for a caller whose text is not a file's
// lines (an editor's text leaf)
export interface TextOffset {
  offset: number;
  length: number;
}

export interface DocText {
  path: string;
  title: string;
  body: string;
}

export type VaultMatch = TextMatch & {
  path: string;
  title: string;
  // this match's index among the doc's matches, in document order
  ordinal: number;
  before: string;
  text: string;
  after: string;
};

// `total` counts every match; `matches` stops at the caller's limit
export interface VaultMatches {
  matches: VaultMatch[];
  total: number;
}

export interface TextReplacement {
  text: string;
  count: number;
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

// several needles as one whole-word, any-case pattern, longest first: an alternation takes the
// first alternative that matches, so where two overlap (`Plan` inside `Plan B`) the longer takes
// the site and the shorter is not counted again inside it. null for no needle
export const anyWholeWordMatcher = (needles: readonly string[]): RegExp | null => {
  const alternatives = needles
    .filter((needle) => needle !== "")
    .toSorted((a, b) => b.length - a.length)
    .map(escapeRegExp);
  return alternatives.length === 0 ? null : new RegExp(wholeWord(alternatives.join("|")), "giu");
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

// `parts` is splitLinesKeepingTerminators' cut, so a caller that already split the text once
// does not split it again
export const findLineMatches = (parts: readonly string[], pattern: RegExp): TextMatch[] => {
  const found: TextMatch[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    for (const hit of hitsIn(pattern, parts[index] ?? "")) {
      found.push({ column: hit.offset, length: hit.length, line: index / 2 + 1 });
    }
  }
  return found;
};

// a function replacement: a `$1` typed into the replace box is text, not a group reference
export const replaceTextMatches = (
  text: string,
  needle: string,
  replacement: string,
  options: TextMatchOptions,
): TextReplacement => {
  if (needle === "") {
    return { count: 0, text };
  }
  const pattern = matcher(needle, options);
  const parts = splitLinesKeepingTerminators(text);
  let count = 0;
  // the callback form, not a replacement string: `$&` and friends in `replacement` are literal here
  const substitute = (): string => {
    count += 1;
    return replacement;
  };
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? "";
    pattern.lastIndex = 0;
    parts[index] = line.replace(pattern, substitute);
  }
  return { count, text: parts.join("") };
};

export const excerptAround = (
  line: string,
  match: TextMatch,
): Pick<VaultMatch, "before" | "text" | "after"> => {
  const start = match.column;
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

// a store may narrow the docs it hands over to those holding one of these ascii substrings,
// case-insensitively; outside ascii the case fold differs by engine, so one such needle means
// every doc is scanned (null)
export const bodyPrefilters = (needles: readonly string[]): string[] | null =>
  needles.every((needle) => PRINTABLE_ASCII.test(needle)) ? [...needles] : null;

const byPath = (a: DocText, b: DocText): number => {
  if (a.path < b.path) {
    return -1;
  }
  if (a.path > b.path) {
    return 1;
  }
  return 0;
};

// in path order, so a re-run reads the same
export const collectVaultMatches = (
  docs: Iterable<DocText>,
  needle: string,
  options: TextMatchOptions,
  limit: number,
): VaultMatches => {
  if (needle === "") {
    return { matches: [], total: 0 };
  }
  const pattern = matcher(needle, options);
  const matches: VaultMatch[] = [];
  let total = 0;
  for (const doc of [...docs].toSorted(byPath)) {
    const parts = splitLinesKeepingTerminators(doc.body);
    const found = findLineMatches(parts, pattern);
    total += found.length;
    if (found.length === 0 || matches.length >= limit) {
      continue;
    }
    for (const [ordinal, match] of found.entries()) {
      if (matches.length >= limit) {
        break;
      }
      const line = parts[(match.line - 1) * 2] ?? "";
      matches.push({
        ...match,
        ...excerptAround(line, match),
        ordinal,
        path: doc.path,
        title: doc.title,
      });
    }
  }
  return { matches, total };
};
