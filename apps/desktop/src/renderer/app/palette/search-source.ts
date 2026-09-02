import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import type {
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
} from "@repo/api/local/knowledge/knowledge-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { NOTE_SEARCH_LIMIT, searchNotesByFilename, type NoteSearchSource } from "./note-search";

export interface NoteSearchApi {
  knowledge: {
    search(
      request: KnowledgeSearchRequest,
      options: { signal: AbortSignal },
    ): Promise<KnowledgeSearchResponse>;
  };
}

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
    // A tag: term suppresses the filename fallback, which would fuzzy-match
    // the literal "tag:foo" against paths.
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
