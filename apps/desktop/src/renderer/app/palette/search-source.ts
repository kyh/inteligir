import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import type {
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
} from "@repo/api/local/knowledge/knowledge-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { NOTE_SEARCH_LIMIT, searchNotesByFilename } from "./note-search";
import type { NoteSearchSource } from "./note-search";

export interface NoteSearchApi {
  knowledge: {
    search: (
      request: KnowledgeSearchRequest,
      options: { signal: AbortSignal },
    ) => Promise<KnowledgeSearchResponse>;
  };
}

export const sortedNotePaths = (entries: readonly VaultEntry[]): string[] =>
  entries
    .filter((entry) => entry.kind === "file" && isDocPath(entry.path))
    .map((entry) => entry.path)
    .toSorted();

export const createSearchSource =
  (api: NoteSearchApi, sortedFilePaths: readonly string[]): NoteSearchSource =>
  async (query, signal) => {
    // A tag: term suppresses the filename fallback, which would fuzzy-match
    // the literal "tag:foo" against paths.
    const tagFiltered = parseSearchQuery(query).tag !== "";
    const byFilename = () => (tagFiltered ? [] : searchNotesByFilename(query, sortedFilePaths));
    if (query.trim() === "") {
      return byFilename();
    }
    try {
      const response = await api.knowledge.search(
        { limit: NOTE_SEARCH_LIMIT, q: query },
        { signal },
      );
      if (response.results.length === 0) {
        return byFilename();
      }
      return response.results.map((result) => ({
        path: result.path,
        snippet: result.snippet,
        title: result.title,
      }));
    } catch {
      return byFilename();
    }
  };
