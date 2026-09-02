// Both engines execute this one policy. Stopwords are dropped, not OR-ed in (a
// note would match on `i` alone); a query left with nothing keeps its tokens as
// a conjunction, since an empty match expression is every note in the vault.
// The prefix term is the last raw token, not the last surviving one: a term
// followed by a stopword was already finished typing.

import { stemmer } from "stemmer";

// the fold matches fts5's unicode61 (`remove_diacritics 2` in the sql store): the stem
// is computed here and folded there, so an unfolded token would index `acción` where
// the store indexes `accion` and a query would reach one engine only
export function tokenize(text: string): string[] {
  return foldDiacritics(text.toLowerCase()).match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function foldDiacritics(text: string): string {
  return text.normalize("NFD").replace(/\p{Mn}+/gu, "");
}

// `stemmer` is imported here and nowhere else, so the engines and the snippet cut cannot diverge
export function stemToken(token: string): string {
  return stemmer(token);
}

// a shadow indexed beside the literal text, never a replacement: a prefix run
// against stems dies where the suffix begins (`hirin` vs `hire`; 86 of 1,555 measured
// prefixes stop retrieving), which is also why fts5's own `porter` tokenizer is not used.
// order and repetition are kept so bm25 sees the same tf as the literal field
export function stemText(text: string): string {
  return tokenize(text).map(stemToken).join(" ");
}

export type SearchQueryTerm = { token: string; stem: string; prefix: boolean };

export type SearchQueryPlan = {
  terms: readonly SearchQueryTerm[];
  match: "all" | "any";
};

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
    .split(/\s+/)
    .filter((word) => word !== ""),
);

export function planSearchQuery(query: string): readonly SearchQueryPlan[] {
  const raw = tokenize(query);
  const typing = raw[raw.length - 1];
  if (typing === undefined) return [];

  const unique = [...new Set(raw)];
  const content = unique.filter((token) => !STOPWORDS.has(token));
  const terms = (content.length > 0 ? content : unique).map((token) => ({
    token,
    stem: stemToken(token),
    prefix: token === typing,
  }));

  if (content.length > CONJUNCTION_MAX_TERMS) return [{ terms, match: "any" }];
  if (content.length < RELAXABLE_MIN_TERMS) return [{ terms, match: "all" }];
  return [
    { terms, match: "all" },
    { terms, match: "any" },
  ];
}
