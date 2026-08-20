// ---------------------------------------------------------------------------
// Vault search: ONE query that carries both text and an optional tag filter.
//
// There is no separate tag browser — a tag is a filter on search, not a mode —
// so this composition is what "search" means everywhere: the palette's box and
// the agent's `search_vault` tool both compose text + tag through here, and a
// `tag:` typed by a user resolves exactly like a `tag` the model passed.
// ---------------------------------------------------------------------------

import { titleFromPath } from "./link-extract";
import type { SearchResult } from "./knowledge-index";

export type VaultSearchSources = {
  /** Ranked lexical search over the vault. */
  search(query: string, limit: number): SearchResult[];
  /** Paths of the notes carrying a tag (case-insensitive). */
  notesWithTag(tag: string): readonly string[];
};

export type VaultSearchParams = {
  /** Free text; empty means "no text filter". */
  query: string;
  /** Tag name without the `#`; absent or empty means "no tag filter". */
  tag?: string | undefined;
  limit: number;
};

// The tag filter runs over ALREADY-ranked hits, so asking the index for exactly
// `limit` and then filtering starves a narrow tag inside a broad query — the
// top hits are mostly untagged and the box comes back empty. Ask for a wider
// window, filter, then cut. Bounded so a large limit can't turn one keystroke
// into a whole-vault scan.
const TAG_WINDOW_FACTOR = 10;
const TAG_WINDOW_MAX = 500;

/** A tag listing has no ranking and no matched line — the path IS the hit, so
 * the title falls back the same way an untitled note's search hit does. */
function taggedRow(path: string): SearchResult {
  return { path, title: titleFromPath(path), snippet: "", score: 0 };
}

/** Text ∧ tag, in that precedence: the tag narrows the set, the text ranks
 * within it. Empty on both counts returns nothing — a search for nothing is
 * not a search for everything. */
export function searchVaultNotes(
  sources: VaultSearchSources,
  params: VaultSearchParams,
): SearchResult[] {
  const query = params.query.trim();
  const tag = params.tag?.trim() ?? "";
  if (tag === "") return query === "" ? [] : sources.search(query, params.limit);

  const tagged = sources.notesWithTag(tag);
  // Sorted here, not trusted from the source: an unranked listing that is cut
  // to `limit` has to be stable, or the same tag answers differently per call.
  if (query === "") return tagged.toSorted().slice(0, params.limit).map(taggedRow);

  const inTag = new Set(tagged);
  const window = Math.min(params.limit * TAG_WINDOW_FACTOR, TAG_WINDOW_MAX);
  return sources
    .search(query, window)
    .filter((hit) => inTag.has(hit.path))
    .slice(0, params.limit);
}

/** The search box's whole grammar: any whitespace-separated `tag:<name>` term
 * is the tag filter, everything else is the text query. Position-free because
 * a user appending a filter to what they already typed is the common case, and
 * only the first one counts — two tag filters would have to mean AND or OR, and
 * a box that silently picks one is worse than a box that takes one. An empty
 * `tag` means no filter, which is also what a bare `tag:` types out to. */
export type ParsedSearchQuery = { query: string; tag: string };

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const terms = raw.split(/\s+/).filter((term) => term !== "");
  let tag = "";
  const text: string[] = [];
  for (const term of terms) {
    if (!term.startsWith("tag:")) {
      text.push(term);
      continue;
    }
    if (tag === "") tag = term.slice(4);
  }
  return { query: text.join(" "), tag };
}
