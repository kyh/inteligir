// ---------------------------------------------------------------------------
// Word / character / paragraph counts for the status bar.
//
// Deliberately naive, and the same shape every other markdown editor uses: the
// markup a reader does not see (list bullets, heading hashes, link syntax,
// backticks) is stripped, and what is left is counted as prose. A segmenter or
// a real parse would disagree with every other editor's number for no reader
// benefit — and this runs on the live buffer, so it has to be cheap.
// ---------------------------------------------------------------------------

export type DocumentStats = {
  words: number;
  characters: number;
  paragraphs: number;
};

/** Leading block markers (`#`, `-`, `1.`, `>`), inline code fences, and the
 * bracket halves of wiki and markdown links. */
const BLOCK_MARKER = /^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/gm;
const BACKTICKS = /`+/g;
const WIKI_LINK = /\[\[([^\]]+)\]\]/g;
const MD_LINK = /\[([^\]]+)\]\([^)]*\)/g;

function prose(markdown: string): string {
  return markdown
    .replace(BLOCK_MARKER, "")
    .replace(BACKTICKS, "")
    .replace(WIKI_LINK, "$1")
    .replace(MD_LINK, "$1")
    .trim();
}

export function documentStats(markdown: string): DocumentStats {
  const text = prose(markdown);
  if (text === "") return { words: 0, characters: 0, paragraphs: 0 };
  return {
    words: text.match(/\S+/g)?.length ?? 0,
    // Runs of whitespace collapse to one, so a hard-wrapped paragraph counts
    // the same as the reflowed one it renders as.
    characters: Array.from(text.replace(/\s+/g, " ")).length,
    paragraphs: text.split(/\n\s*\n/).filter((block) => block.trim() !== "").length,
  };
}
