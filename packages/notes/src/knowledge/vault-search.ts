// a tag is a filter on search, not a mode: the palette and the agent's search tool both
// compose text + tag here.

import { docStem } from "./doc-file";
import type { SearchResult } from "./knowledge-index";

export type VaultSearchSources = {
  search(query: string, limit: number): SearchResult[];
  notesWithTag(tag: string): readonly string[];
};

export type VaultSearchParams = {
  query: string;
  tag?: string | undefined;
  limit: number;
};

// the tag filter runs over already-ranked hits, so asking for exactly `limit` starves a narrow
// tag inside a broad query; ask wider, filter, then cut. bounded so a large limit can't scan
// the whole vault per keystroke.
const TAG_WINDOW_FACTOR = 10;
const TAG_WINDOW_MAX = 500;

function taggedRow(path: string): SearchResult {
  return { path, title: docStem(path), snippet: "", score: 0 };
}

// empty on both counts returns nothing: a search for nothing is not a search for everything.
export function searchVaultNotes(
  sources: VaultSearchSources,
  params: VaultSearchParams,
): SearchResult[] {
  const query = params.query.trim();
  const tag = params.tag?.trim() ?? "";
  if (tag === "") return query === "" ? [] : sources.search(query, params.limit);

  const tagged = sources.notesWithTag(tag);
  // sorted here, not trusted from the source: an unranked listing cut to `limit` must be stable.
  if (query === "") return tagged.toSorted().slice(0, params.limit).map(taggedRow);

  const inTag = new Set(tagged);
  const window = Math.min(params.limit * TAG_WINDOW_FACTOR, TAG_WINDOW_MAX);
  return sources
    .search(query, window)
    .filter((hit) => inTag.has(hit.path))
    .slice(0, params.limit);
}

// only the first `tag:` counts: two would have to mean AND or OR.
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
