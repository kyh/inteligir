// The palette's note-search seam: ONE injected async function between the
// query box and the hit list, so the palette renders hits without knowing how
// they were found. The workspace composes the real source — the knowledge
// index's full-text + tag search (`tag:<name>` terms parse engine-side) with
// the filename tiers below as the zero-query view and the fallback when the
// index answers nothing or errors.

import { basenamePath } from "@repo/notes/knowledge/vault-path";

export interface NoteSearchHit {
  path: string;
  /** The doc's title when the source knows one (the knowledge index does). */
  title?: string;
  /** A match snippet when the source has one. */
  snippet?: string;
}

/** `signal` aborts a superseded query's request; the palette owns the
 *  controller and never renders an aborted answer. */
export type NoteSearchSource = (query: string, signal: AbortSignal) => Promise<NoteSearchHit[]>;

export const NOTE_SEARCH_LIMIT = 12;

/** True when every character of `query` appears in `text` in order. */
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

/** Filename-tier fuzzy match: ranked name-prefix > name-substring >
 *  path-substring > path-subsequence, alphabetical within a tier. */
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
