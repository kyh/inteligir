// The one tokenizer and the one search policy: an item's search vector, a query's terms and a
// passage's matches are all cut by it, so none of them can disagree on what a word is. Stopwords
// are dropped, not OR-ed in (a note would match on `i` alone); a query left with nothing keeps its
// tokens as a conjunction, since an empty match expression is every item in the library. The
// prefix term is the last raw token, not the last surviving one: a term followed by a stopword was
// already finished typing.

import { stemmer } from "stemmer";

// marks folded away, so `acción` and `accion` are one word wherever they are written
const foldDiacritics = (text: string): string => text.normalize("NFD").replaceAll(/\p{Mn}+/gu, "");

export const tokenize = (text: string): string[] =>
  foldDiacritics(text.toLowerCase()).match(/[\p{L}\p{N}_]+/gu) ?? [];

// `stemmer` is imported here and nowhere else, so the vector's stems and a query's cannot diverge
export const stemToken = (token: string): string => stemmer(token);

export interface SearchQueryTerm {
  readonly token: string;
  readonly stem: string;
  readonly prefix: boolean;
}

export interface SearchQueryPlan {
  readonly terms: readonly SearchQueryTerm[];
  readonly match: "all" | "any";
}

// at or below, the query is a lookup and every term is required; above, a sentence the ranking decides
const CONJUNCTION_MAX_TERMS = 2;

// below this a conjunction and a disjunction ask the same question
const RELAXABLE_MIN_TERMS = 2;

// shorter than the published lists: words with a topical reading ("other", "more", "few") stay searchable
const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at
   be because been before being below between both but by
   can could did do does doing done down during
   each for from further
   had has have having he her here hers herself him himself his how
   i if in into is it its itself
   just me my myself
   nor not now of off on once only or our ours ourselves out over
   s should so some such
   t than that the their theirs them themselves then there these they this those through to too
   under until up us
   very was we were what when where whether which while who whom why will with would
   you your yours yourself`
    .split(/\s+/u)
    .filter((word) => word !== ""),
);

// a query is a box still being typed into, so its last word also matches as a prefix
export const planSearchQuery = (query: string): readonly SearchQueryPlan[] => {
  const raw = tokenize(query);
  const typing = raw.at(-1);
  if (typing === undefined) {
    return [];
  }

  const unique = [...new Set(raw)];
  const content = unique.filter((token) => !STOPWORDS.has(token));
  const terms = (content.length > 0 ? content : unique).map((token) => ({
    prefix: token === typing,
    stem: stemToken(token),
    token,
  }));

  if (content.length > CONJUNCTION_MAX_TERMS) {
    return [{ match: "any", terms }];
  }
  if (content.length < RELAXABLE_MIN_TERMS) {
    return [{ match: "all", terms }];
  }
  return [
    { match: "all", terms },
    { match: "any", terms },
  ];
};
