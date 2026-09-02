import { basenamePath } from "@repo/notes/knowledge/vault-path";

export interface NoteSearchHit {
  path: string;
  title?: string;
  snippet?: string;
}

export type NoteSearchSource = (query: string, signal: AbortSignal) => Promise<NoteSearchHit[]>;

export const NOTE_SEARCH_LIMIT = 12;

function isSubsequence(query: string, text: string): boolean {
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
}

export function searchNotesByFilename(
  query: string,
  filePaths: readonly string[],
): NoteSearchHit[] {
  const needle = query.trim().toLowerCase();
  const sorted = filePaths.toSorted();
  if (needle === "") {
    return sorted.slice(0, NOTE_SEARCH_LIMIT).map((path) => ({ path }));
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
    .map((path) => ({ path }));
}
