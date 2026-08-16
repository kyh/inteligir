// The palette's note-search seam: ONE swappable function between the query
// box and the hit list, so upgrading the source never touches the palette.
//
// TODO(#547): when the knowledge index lands its contract module
// (packages/server-contract/src/knowledge.ts), swap in full-text search here —
// same signature, async source, palette untouched.

interface NoteSearchHit {
  path: string;
}

export type NoteSearchSource = (query: string, filePaths: readonly string[]) => NoteSearchHit[];

const RESULT_LIMIT = 12;

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

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
export const searchNotesByFilename: NoteSearchSource = (query, filePaths) => {
  const needle = query.trim().toLowerCase();
  const sorted = filePaths.toSorted();
  if (needle === "") {
    return sorted.slice(0, RESULT_LIMIT).map((path) => ({ path }));
  }
  const tiers: string[][] = [[], [], [], []];
  for (const path of sorted) {
    const lowerPath = path.toLowerCase();
    const name = basename(lowerPath);
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
    .slice(0, RESULT_LIMIT)
    .map((path) => ({ path }));
};
