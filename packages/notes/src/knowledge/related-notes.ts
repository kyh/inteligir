// ---------------------------------------------------------------------------
// Related notes — the "notes you forgot are connected to this one" scorer.
// PURE and platform-neutral: it reads the link graph / tag index through a
// minimal structural view (LinkGraphIndex satisfies it directly) plus an
// OPTIONAL injected lexical `search` port, so the ranking brain exists once
// while each composition brings its own text engine — the in-memory tiered
// SearchIndex (core reference, dev harness) or the SQL store's FTS5 bm25
// (desktop host). No ML, no embeddings (that's a v2, separately).
//
// Signals, cheapest-first over what the knowledge engine already holds:
//   - shared link targets (bibliographic coupling): the candidate links to
//     the same notes this note links to;
//   - co-citation: a third note links to both this note and the candidate;
//   - shared tags (inline `#tags` ∪ frontmatter tags, case-unified);
//   - lexical similarity: per-title-token search hits, max-normalized so the
//     two engines' incompatible score scales never leak into the blend.
//
// DIRECT neighbors (notes this note links to / notes linking to it) are
// excluded by design: the Links + Backlinks panels already surface them, and
// the point of Related is the ring the user has NOT already wired up.
//
// Privacy mirrors backlinks() exactly (link-graph-index.ts): everything is
// visible by default (a private note is the user's own screen), and under
// `excludePrivate` a private SUBJECT yields [] silently while private
// candidates drop entirely — never annotated, indistinguishable from absent.
// ---------------------------------------------------------------------------

import type { PrivacyOpts } from "./link-graph-index";
import { tokenize } from "./search-index";

/** One ranked related note. `reasons` is the explainability payload — short
 * human sentences ("both link to X", "shares #tag", "similar text") the
 * renderer shows as a hint and the agent tool prints verbatim. */
export type RelatedNoteEntry = {
  path: string;
  title: string;
  score: number;
  reasons: string[];
};

export type RelatedNotesOpts = PrivacyOpts & {
  /** Max entries returned (default {@link RELATED_DEFAULT_LIMIT}). */
  limit?: number;
};

/** The graph/tag queries the scorer reads — a LinkGraphIndex instance
 * satisfies this structurally, so compositions pass it as-is. */
export type RelatedNotesGraph = {
  forwardLinks(path: string): ReadonlyArray<{ targetPath: string | null }>;
  backlinks(path: string): ReadonlyArray<{ sourcePath: string }>;
  /** The doc's tags in display case (empty for unknown paths). */
  tagsOf(path: string): readonly string[];
  notesWithTag(tag: string): readonly string[];
  titleOf(path: string): string | null;
  isPrivate(path: string): boolean | undefined;
};

/** Ranked lexical hits for one query token; higher score = better (both
 * engines already normalize score DIRECTION, never scale — the scorer
 * max-normalizes, so the in-memory tiers and FTS5 bm25 blend identically). */
export type LexicalSearch = (
  query: string,
  limit: number,
) => ReadonlyArray<{ path: string; score: number }>;

export const RELATED_DEFAULT_LIMIT = 8;

// Weights: one shared link (either direction of indirection) outranks one
// shared tag; the whole lexical signal is capped below two shared links so
// title-word coincidence can never drown a real structural connection.
const SHARED_TARGET_WEIGHT = 2;
const CO_CITATION_WEIGHT = 2;
const SHARED_TAG_WEIGHT = 1;
const LEXICAL_MAX_WEIGHT = 3;
/** Per-token candidate window for the lexical probe. */
const LEXICAL_PROBE_LIMIT = 24;
/** Title tokens probed at most (a pathological title stays cheap). */
const LEXICAL_MAX_TOKENS = 8;
/** Tokens shorter than this ("a", "of", "to") are stop-word noise. */
const LEXICAL_MIN_TOKEN_LENGTH = 3;

/** Rank the notes related to `path`, best-first, with `reasons`. Empty when
 * the note has no connections (or, under `excludePrivate`, is private).
 * `search: null` scores links + tags only (a composition without a text
 * engine loses the lexical signal, nothing else). */
export function relatedNotes(
  sources: RelatedNotesGraph,
  search: LexicalSearch | null,
  path: string,
  opts?: RelatedNotesOpts,
): RelatedNoteEntry[] {
  const excludePrivate = opts?.excludePrivate === true;
  // Private SUBJECT → silent [] (backlinks' rule): the response must be
  // indistinguishable from "no related notes" so it never confirms the path.
  if (excludePrivate && sources.isPrivate(path) === true) return [];

  const isDoc = (candidate: string): boolean => sources.titleOf(candidate) !== null;

  // The direct ring — resolved forward doc-targets and backlink sources —
  // doubles as the exclusion set (see header) and the indirection basis.
  const targets = new Set<string>();
  for (const { targetPath } of sources.forwardLinks(path)) {
    if (targetPath !== null && targetPath !== path && isDoc(targetPath)) targets.add(targetPath);
  }
  const citers = new Set<string>();
  for (const { sourcePath } of sources.backlinks(path)) {
    if (sourcePath !== path) citers.add(sourcePath);
  }
  const excluded = (candidate: string): boolean =>
    candidate === path || targets.has(candidate) || citers.has(candidate) || !isDoc(candidate);

  // Shared targets: who else links to what this note links to?
  const sharedTargets = new Map<string, Set<string>>();
  for (const target of targets) {
    for (const { sourcePath } of sources.backlinks(target)) {
      if (excluded(sourcePath)) continue;
      let set = sharedTargets.get(sourcePath);
      if (!set) sharedTargets.set(sourcePath, (set = new Set()));
      set.add(target);
    }
  }

  // Co-citation: what else do the notes citing this one link to?
  const coCiters = new Map<string, Set<string>>();
  for (const citer of citers) {
    for (const { targetPath } of sources.forwardLinks(citer)) {
      if (targetPath === null || excluded(targetPath)) continue;
      let set = coCiters.get(targetPath);
      if (!set) coCiters.set(targetPath, (set = new Set()));
      set.add(citer);
    }
  }

  // Shared tags (display case rides along for the reason string).
  const sharedTags = new Map<string, string[]>();
  for (const tag of sources.tagsOf(path)) {
    for (const candidate of sources.notesWithTag(tag)) {
      if (excluded(candidate)) continue;
      const list = sharedTags.get(candidate);
      if (list) list.push(tag);
      else sharedTags.set(candidate, [tag]);
    }
  }

  // Lexical: per-title-token probes merged by score sum, then max-normalized
  // into a bounded contribution — scale-free across engines.
  const lexical = new Map<string, number>();
  if (search) {
    const title = sources.titleOf(path);
    const tokens = title === null ? [] : [...new Set(tokenize(title))];
    for (const token of tokens
      .filter((t) => t.length >= LEXICAL_MIN_TOKEN_LENGTH)
      .slice(0, LEXICAL_MAX_TOKENS)) {
      for (const hit of search(token, LEXICAL_PROBE_LIMIT)) {
        if (excluded(hit.path) || hit.score <= 0) continue;
        lexical.set(hit.path, (lexical.get(hit.path) ?? 0) + hit.score);
      }
    }
  }
  let lexicalMax = 0;
  for (const score of lexical.values()) lexicalMax = Math.max(lexicalMax, score);

  const candidates = new Set<string>([
    ...sharedTargets.keys(),
    ...coCiters.keys(),
    ...sharedTags.keys(),
    ...lexical.keys(),
  ]);

  const entries: RelatedNoteEntry[] = [];
  for (const candidate of candidates) {
    // Private CANDIDATES drop entirely under excludePrivate — same silent
    // rule backlinks applies to private link sources.
    if (excludePrivate && sources.isPrivate(candidate) === true) continue;
    const viaTargets = sharedTargets.get(candidate);
    const viaCiters = coCiters.get(candidate);
    const viaTags = sharedTags.get(candidate);
    const lexicalScore =
      lexicalMax > 0 ? (LEXICAL_MAX_WEIGHT * (lexical.get(candidate) ?? 0)) / lexicalMax : 0;
    const score =
      SHARED_TARGET_WEIGHT * (viaTargets?.size ?? 0) +
      CO_CITATION_WEIGHT * (viaCiters?.size ?? 0) +
      SHARED_TAG_WEIGHT * (viaTags?.length ?? 0) +
      lexicalScore;
    if (score <= 0) continue;
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
    if (lexicalScore > 0) reasons.push("similar text");
    entries.push({
      path: candidate,
      title: sources.titleOf(candidate) ?? candidate,
      score,
      reasons,
    });
  }

  const limit = Math.max(1, opts?.limit ?? RELATED_DEFAULT_LIMIT);
  return entries
    .toSorted((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
    .slice(0, limit);
}

function titleOr(sources: RelatedNotesGraph): (path: string) => string {
  return (path) => sources.titleOf(path) ?? path;
}

/** "A", "A and B", "A, B and 2 more" — reason lists stay one short clause. */
const LIST_SHOWN = 2;

function formatList(items: readonly string[]): string {
  if (items.length <= LIST_SHOWN) return items.join(" and ");
  const rest = items.length - LIST_SHOWN;
  return `${items.slice(0, LIST_SHOWN).join(", ")} and ${rest} more`;
}
