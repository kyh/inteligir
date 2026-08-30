// The palette's REAL search source: the knowledge index's full-text + tag
// search (`tag:<name>` terms parse engine-side), with note-search's filename
// tiers as the zero-query view and the fallback when the index answers
// nothing (a filename-shaped query FTS misses) or errors.
//
// The composition lives here rather than in note-search, which is deliberately
// pure — it knows fuzzy matching and nothing about a client.

import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import type {
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
} from "@repo/api/local/knowledge/knowledge-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { NOTE_SEARCH_LIMIT, searchNotesByFilename, type NoteSearchSource } from "./note-search";

/** The one procedure the palette reaches, structurally — so a caller (and a
 *  test) hands over what this source uses rather than the whole client. */
export interface NoteSearchApi {
  knowledge: {
    search(
      request: KnowledgeSearchRequest,
      options: { signal: AbortSignal },
    ): Promise<KnowledgeSearchResponse>;
  };
}

/** The vault's notes, sorted: the tree also holds comment sidecars and
 *  assets, and the filename fallback must answer the same question the index
 *  does. */
export function sortedNotePaths(entries: readonly VaultEntry[]): string[] {
  return entries
    .filter((entry) => entry.kind === "file" && isDocPath(entry.path))
    .map((entry) => entry.path)
    .toSorted();
}

export function createSearchSource(
  api: NoteSearchApi,
  sortedFilePaths: readonly string[],
): NoteSearchSource {
  return async (query, signal) => {
    // A `tag:` term is a question only the index can answer, so it suppresses
    // the filename fallback: fuzzy-matching the literal string "tag:foo"
    // against paths answers a different question with a straight face.
    const tagFiltered = parseSearchQuery(query).tag !== "";
    const byFilename = () => (tagFiltered ? [] : searchNotesByFilename(query, sortedFilePaths));
    if (query.trim() === "") {
      return byFilename();
    }
    try {
      const response = await api.knowledge.search(
        { q: query, limit: NOTE_SEARCH_LIMIT },
        { signal },
      );
      if (response.results.length === 0) {
        return byFilename();
      }
      return response.results.map((result) => ({
        path: result.path,
        title: result.title,
        snippet: result.snippet,
      }));
    } catch {
      return byFilename();
    }
  };
}
