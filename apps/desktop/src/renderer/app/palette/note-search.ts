import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { visibleEntries } from "../vault-hooks";

// `title` is null when there is none to show, so the row falls back to the path
export interface NoteSearchHit {
  path: string;
  title: string | null;
}

export const NOTE_SEARCH_LIMIT = 12;

// the notes the rail lists, so a dot-folder's docs are no more reachable here than there
export const listedNotePaths = (entries: readonly VaultEntry[]): string[] =>
  visibleEntries(entries)
    .filter((entry) => entry.kind === "file" && isDocPath(entry.path))
    .map((entry) => entry.path);

const isSubsequence = (query: string, text: string): boolean => {
  let at = 0;
  for (const char of text) {
    if (char === query[at]) {
      at += 1;
      if (at === query.length) {
        return true;
      }
    }
  }
  return query.length === 0;
};

export const searchNotesByFilename = (
  query: string,
  filePaths: readonly string[],
): NoteSearchHit[] => {
  // a tag filter is the index's question alone: fuzzy-matched as a path, "tag:plans" would
  // reach `notes/tagging.md` as a subsequence
  if (parseSearchQuery(query).tag !== "") {
    return [];
  }
  const needle = query.trim().toLowerCase();
  const sorted = filePaths.toSorted();
  if (needle === "") {
    return sorted.slice(0, NOTE_SEARCH_LIMIT).map((path) => ({ path, title: null }));
  }
  const tiers: string[][] = [[], [], [], []];
  for (const path of sorted) {
    const lowerPath = path.toLowerCase();
    const name = basenamePath(lowerPath);
    if (name.startsWith(needle)) {
      tiers[0]?.push(path);
    } else if (name.includes(needle)) {
      tiers[1]?.push(path);
    } else if (lowerPath.includes(needle)) {
      tiers[2]?.push(path);
    } else if (isSubsequence(needle, lowerPath)) {
      tiers[3]?.push(path);
    }
  }
  return tiers
    .flat()
    .slice(0, NOTE_SEARCH_LIMIT)
    .map((path) => ({ path, title: null }));
};
