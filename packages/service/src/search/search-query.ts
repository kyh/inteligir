import { stemmer } from "stemmer";

const foldDiacritics = (text: string) => text.normalize("NFD").replaceAll(/\p{Mn}+/gu, "");

export const tokenize = (text: string) =>
  (foldDiacritics(text.toLowerCase()).match(/[\p{L}\p{N}_]+/gu) ?? []) satisfies string[];

export const stemToken = (token: string) => stemmer(token);

export interface SearchQueryTerm {
  readonly token: string;
  readonly stem: string;
  readonly prefix: boolean;
}

export interface SearchQueryPlan {
  readonly terms: readonly SearchQueryTerm[];
  readonly match: "all" | "any";
}

const CONJUNCTION_MAX_TERMS = 2;

const RELAXABLE_MIN_TERMS = 2;

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

export const planSearchQuery = (query: string) => {
  const raw = tokenize(query);
  const typing = raw.at(-1);

  if (typing === undefined) {
    return [] satisfies readonly SearchQueryPlan[];
  }

  const unique = [...new Set(raw)];
  const content = unique.filter((token) => !STOPWORDS.has(token));

  const terms = (content.length > 0 ? content : unique).map((token) => ({
    prefix: token === typing,
    stem: stemToken(token),
    token,
  }));

  if (content.length > CONJUNCTION_MAX_TERMS) {
    return [{ match: "any", terms }] satisfies readonly SearchQueryPlan[];
  }

  if (content.length < RELAXABLE_MIN_TERMS) {
    return [{ match: "all", terms }] satisfies readonly SearchQueryPlan[];
  }

  return [
    { match: "all", terms },
    { match: "any", terms },
  ] satisfies readonly SearchQueryPlan[];
};
