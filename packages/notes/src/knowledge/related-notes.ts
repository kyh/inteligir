// Direct neighbours (linked to, linking here) are excluded: the panels already
// surface them, and Related is the ring the user has not wired up.

import { tokenize } from "./search-query";

export interface RelatedNoteEntry {
  path: string;
  title: string;
  score: number;
  reasons: string[];
}

export interface RelatedNotesOpts {
  limit?: number;
}

export interface RelatedNotesGraph {
  forwardLinks: (path: string) => readonly { targetPath: string | null }[];
  backlinks: (path: string) => readonly { sourcePath: string }[];
  tagsOf: (path: string) => readonly string[];
  notesWithTag: (tag: string) => readonly string[];
  titleOf: (path: string) => string | null;
}

export type LexicalSearch = (
  query: string,
  limit: number,
) => readonly { path: string; score: number }[];

export const RELATED_DEFAULT_LIMIT = 8;

// one shared link outranks one shared tag; lexical is capped below two shared links
// so title-word coincidence never drowns a structural connection
const SHARED_TARGET_WEIGHT = 2;
const CO_CITATION_WEIGHT = 2;
const SHARED_TAG_WEIGHT = 1;
const LEXICAL_MAX_WEIGHT = 3;
const LEXICAL_PROBE_LIMIT = 24;
const LEXICAL_MAX_TOKENS = 8;
const LEXICAL_MIN_TOKEN_LENGTH = 3;

const titleOr =
  (sources: RelatedNotesGraph): ((path: string) => string) =>
  (path) =>
    sources.titleOf(path) ?? path;

const LIST_SHOWN = 2;

const formatList = (items: readonly string[]): string => {
  if (items.length <= LIST_SHOWN) {
    return items.join(" and ");
  }
  const rest = items.length - LIST_SHOWN;
  return `${items.slice(0, LIST_SHOWN).join(", ")} and ${rest} more`;
};

type Excluded = (candidate: string) => boolean;

const collectTargets = (
  sources: RelatedNotesGraph,
  path: string,
  isDoc: (candidate: string) => boolean,
): Set<string> => {
  const targets = new Set<string>();
  for (const { targetPath } of sources.forwardLinks(path)) {
    if (targetPath !== null && targetPath !== path && isDoc(targetPath)) {
      targets.add(targetPath);
    }
  }
  return targets;
};

const collectCiters = (sources: RelatedNotesGraph, path: string): Set<string> => {
  const citers = new Set<string>();
  for (const { sourcePath } of sources.backlinks(path)) {
    if (sourcePath !== path) {
      citers.add(sourcePath);
    }
  }
  return citers;
};

const collectSharedTargets = (
  sources: RelatedNotesGraph,
  targets: ReadonlySet<string>,
  excluded: Excluded,
): Map<string, Set<string>> => {
  const sharedTargets = new Map<string, Set<string>>();
  for (const target of targets) {
    for (const { sourcePath } of sources.backlinks(target)) {
      if (excluded(sourcePath)) {
        continue;
      }
      let set = sharedTargets.get(sourcePath);
      if (!set) {
        set = new Set();
        sharedTargets.set(sourcePath, set);
      }
      set.add(target);
    }
  }
  return sharedTargets;
};

const collectCoCiters = (
  sources: RelatedNotesGraph,
  citers: ReadonlySet<string>,
  excluded: Excluded,
): Map<string, Set<string>> => {
  const coCiters = new Map<string, Set<string>>();
  for (const citer of citers) {
    for (const { targetPath } of sources.forwardLinks(citer)) {
      if (targetPath === null || excluded(targetPath)) {
        continue;
      }
      let set = coCiters.get(targetPath);
      if (!set) {
        set = new Set();
        coCiters.set(targetPath, set);
      }
      set.add(citer);
    }
  }
  return coCiters;
};

const collectSharedTags = (
  sources: RelatedNotesGraph,
  path: string,
  excluded: Excluded,
): Map<string, string[]> => {
  const sharedTags = new Map<string, string[]>();
  for (const tag of sources.tagsOf(path)) {
    for (const candidate of sources.notesWithTag(tag)) {
      if (excluded(candidate)) {
        continue;
      }
      const list = sharedTags.get(candidate);
      if (list) {
        list.push(tag);
      } else {
        sharedTags.set(candidate, [tag]);
      }
    }
  }
  return sharedTags;
};

const collectLexical = (
  sources: RelatedNotesGraph,
  search: LexicalSearch,
  path: string,
  excluded: Excluded,
): Map<string, number> => {
  const lexical = new Map<string, number>();
  const title = sources.titleOf(path);
  const tokens = title === null ? [] : [...new Set(tokenize(title))];
  for (const token of tokens
    .filter((t) => t.length >= LEXICAL_MIN_TOKEN_LENGTH)
    .slice(0, LEXICAL_MAX_TOKENS)) {
    for (const hit of search(token, LEXICAL_PROBE_LIMIT)) {
      if (excluded(hit.path) || hit.score <= 0) {
        continue;
      }
      lexical.set(hit.path, (lexical.get(hit.path) ?? 0) + hit.score);
    }
  }
  return lexical;
};

const maxScore = (scores: ReadonlyMap<string, number>): number => {
  let max = 0;
  for (const score of scores.values()) {
    max = Math.max(max, score);
  }
  return max;
};

interface RelatedSignals {
  coCiters: ReadonlyMap<string, ReadonlySet<string>>;
  lexical: ReadonlyMap<string, number>;
  // the divisor: the two engines' score scales are incompatible, so lexical is max-normalized
  lexicalMax: number;
  sharedTags: ReadonlyMap<string, readonly string[]>;
  sharedTargets: ReadonlyMap<string, ReadonlySet<string>>;
}

const entryFor = (
  sources: RelatedNotesGraph,
  candidate: string,
  signals: RelatedSignals,
): RelatedNoteEntry | null => {
  const viaTargets = signals.sharedTargets.get(candidate);
  const viaCiters = signals.coCiters.get(candidate);
  const viaTags = signals.sharedTags.get(candidate);
  const lexicalScore =
    signals.lexicalMax > 0
      ? (LEXICAL_MAX_WEIGHT * (signals.lexical.get(candidate) ?? 0)) / signals.lexicalMax
      : 0;
  const score =
    SHARED_TARGET_WEIGHT * (viaTargets?.size ?? 0) +
    CO_CITATION_WEIGHT * (viaCiters?.size ?? 0) +
    SHARED_TAG_WEIGHT * (viaTags?.length ?? 0) +
    lexicalScore;
  if (score <= 0) {
    return null;
  }
  const reasons: string[] = [];
  if (viaTargets && viaTargets.size > 0) {
    reasons.push(`both link to ${formatList([...viaTargets].map(titleOr(sources)))}`);
  }
  if (viaCiters && viaCiters.size > 0) {
    reasons.push(`linked together in ${formatList([...viaCiters].map(titleOr(sources)))}`);
  }
  if (viaTags && viaTags.length > 0) {
    reasons.push(`shares ${formatList(viaTags.map((tag) => `#${tag}`))}`);
  }
  if (lexicalScore > 0) {
    reasons.push("similar text");
  }
  return {
    path: candidate,
    reasons,
    score,
    title: sources.titleOf(candidate) ?? candidate,
  };
};

export const relatedNotes = (
  sources: RelatedNotesGraph,
  search: LexicalSearch,
  path: string,
  opts?: RelatedNotesOpts,
): RelatedNoteEntry[] => {
  const isDoc = (candidate: string): boolean => sources.titleOf(candidate) !== null;

  const targets = collectTargets(sources, path, isDoc);
  const citers = collectCiters(sources, path);
  const excluded: Excluded = (candidate) =>
    candidate === path || targets.has(candidate) || citers.has(candidate) || !isDoc(candidate);

  const sharedTargets = collectSharedTargets(sources, targets, excluded);
  const coCiters = collectCoCiters(sources, citers, excluded);
  const sharedTags = collectSharedTags(sources, path, excluded);
  const lexical = collectLexical(sources, search, path, excluded);
  const signals: RelatedSignals = {
    coCiters,
    lexical,
    lexicalMax: maxScore(lexical),
    sharedTags,
    sharedTargets,
  };

  const candidates = new Set<string>([
    ...sharedTargets.keys(),
    ...coCiters.keys(),
    ...sharedTags.keys(),
    ...lexical.keys(),
  ]);

  const entries: RelatedNoteEntry[] = [];
  for (const candidate of candidates) {
    const entry = entryFor(sources, candidate, signals);
    if (entry !== null) {
      entries.push(entry);
    }
  }

  const limit = Math.max(1, opts?.limit ?? RELATED_DEFAULT_LIMIT);
  return entries
    .toSorted((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
    .slice(0, limit);
};
