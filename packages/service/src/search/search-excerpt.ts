import type { TextOffset } from "@repo/editor/headless/knowledge/text-matches";

import { stemToken, tokenize } from "./search-query";
import type { SearchQueryTerm } from "./search-query";

const EXCERPT_BEFORE = 40;
const EXCERPT_AFTER = 80;

export const excerptAround = (line: string, match: TextOffset) => {
  const from = Math.max(0, match.offset - EXCERPT_BEFORE);
  const to = Math.min(line.length, match.offset + match.length + EXCERPT_AFTER);

  return `${from > 0 ? "…" : ""}${line.slice(from, to)}${to < line.length ? "…" : ""}`;
};

export type FindMatch = (line: string) => TextOffset | undefined;

const LINE_END = /\r\n|\r|\n/u;

export const passageIn = (text: string, find: FindMatch) => {
  for (const raw of text.split(LINE_END)) {
    const line = raw.trim();
    const match = find(line);

    if (match !== undefined) {
      return excerptAround(line, match);
    }
  }

  return null;
};

const WORD = /[\p{L}\p{N}\p{Mn}_]+/gu;

const tokenMatches = (token: string, terms: readonly SearchQueryTerm[]) => {
  if (terms.some((term) => token === term.token || (term.prefix && token.startsWith(term.token)))) {
    return true;
  }

  const stem = stemToken(token);

  return terms.some((term) => stem === term.stem);
};

export const termMatch = (terms: readonly SearchQueryTerm[]) =>
  ((line) => {
    for (const word of line.matchAll(WORD)) {
      if (tokenize(word[0]).some((token) => tokenMatches(token, terms))) {
        return { length: word[0].length, offset: word.index };
      }
    }
  }) satisfies FindMatch;
