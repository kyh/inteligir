// Literal occurrences, not the search engine's tokens: FTS5 cannot answer where inside a
// line a hit sits, and a replace must touch exactly the bytes the rows showed. One matcher
// serves the listing and the rewrite, so the two cannot disagree.

import { splitLinesKeepingTerminators } from "./source-lines";

export type TextMatchOptions = { caseSensitive: boolean; wholeWord: boolean };

// line is 1-based; column is the utf-16 offset inside that line
export type TextMatch = { line: number; column: number; length: number };

export type DocText = { path: string; title: string; body: string };

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
export type VaultMatches = { matches: VaultMatch[]; total: number };

export type TextReplacement = { text: string; count: number };

const EXCERPT_BEFORE = 40;
const EXCERPT_AFTER = 80;
const ELLIPSIS = "…";

function escapeRegExp(needle: string): string {
  return needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// the `i` flag under `u` folds case the unicode way, so offsets stay those of the original text
function matcher(needle: string, options: TextMatchOptions): RegExp {
  const literal = escapeRegExp(needle);
  const source = options.wholeWord ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])` : literal;
  return new RegExp(source, options.caseSensitive ? "gu" : "giu");
}

export function findTextMatches(
  text: string,
  needle: string,
  options: TextMatchOptions,
): TextMatch[] {
  if (needle === "") return [];
  const pattern = matcher(needle, options);
  const parts = splitLinesKeepingTerminators(text);
  const found: TextMatch[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? "";
    pattern.lastIndex = 0;
    for (let hit = pattern.exec(line); hit !== null; hit = pattern.exec(line)) {
      found.push({ line: index / 2 + 1, column: hit.index, length: hit[0].length });
    }
  }
  return found;
}

// a function replacement: a `$1` typed into the replace box is text, not a group reference
export function replaceTextMatches(
  text: string,
  needle: string,
  replacement: string,
  options: TextMatchOptions,
): TextReplacement {
  if (needle === "") return { text, count: 0 };
  const pattern = matcher(needle, options);
  const parts = splitLinesKeepingTerminators(text);
  let count = 0;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? "";
    pattern.lastIndex = 0;
    parts[index] = line.replace(pattern, () => {
      count += 1;
      return replacement;
    });
  }
  return { text: parts.join(""), count };
}

export function excerptAround(
  line: string,
  match: TextMatch,
): Pick<VaultMatch, "before" | "text" | "after"> {
  const start = match.column;
  const end = start + match.length;
  const from = Math.max(0, start - EXCERPT_BEFORE);
  const to = Math.min(line.length, end + EXCERPT_AFTER);
  return {
    before: `${from > 0 ? ELLIPSIS : ""}${line.slice(from, start)}`,
    text: line.slice(start, end),
    after: `${line.slice(end, to)}${to < line.length ? ELLIPSIS : ""}`,
  };
}

// a store may narrow the docs it hands over by an ascii substring, case-insensitively;
// outside ascii the case fold differs by engine, so every doc is scanned
export function bodyPrefilter(needle: string): string | null {
  return /^[\x20-\x7e]+$/u.test(needle) ? needle : null;
}

// in path order, so a re-run reads the same
export function collectVaultMatches(
  docs: Iterable<DocText>,
  needle: string,
  options: TextMatchOptions,
  limit: number,
): VaultMatches {
  const sorted = [...docs].toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const matches: VaultMatch[] = [];
  let total = 0;
  for (const doc of sorted) {
    const found = findTextMatches(doc.body, needle, options);
    if (found.length === 0) continue;
    total += found.length;
    if (matches.length >= limit) continue;
    const lines = splitLinesKeepingTerminators(doc.body);
    for (const [ordinal, match] of found.entries()) {
      if (matches.length >= limit) break;
      const line = lines[(match.line - 1) * 2] ?? "";
      matches.push({
        ...match,
        ...excerptAround(line, match),
        path: doc.path,
        title: doc.title,
        ordinal,
      });
    }
  }
  return { matches, total };
}
