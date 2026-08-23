// The canvas payload's header lines, in ONE place: the parser, the sketch
// writer and the slash-menu seed all have to agree, and a drifted spelling
// would make a freshly inserted canvas unreadable to its own parser.
//
// Moss's `[moss:…]` spellings PARSE FOREVER — vaults exist that hold them —
// but only ours is ever WRITTEN, so a converted note canonicalizes the first
// time its canvas is edited.

export const GRID_HEADER = "[inteligir:grid:v2]";
const LEGACY_GRID_HEADER = "[moss:grid:v2]";

export const LABELS_PREFIX = "[inteligir:labels:";
const LEGACY_LABELS_PREFIX = "[moss:labels:";

/** True when `line` opens a canvas payload, in either spelling. */
export function isGridHeader(line: string | undefined): boolean {
  const trimmed = line?.trim();
  return trimmed === GRID_HEADER || trimmed === LEGACY_GRID_HEADER;
}

/**
 * The labels-line prefix `line` actually carries, or null when it is not a
 * labels line. Callers slice by the returned prefix's length rather than
 * assuming ours, so a legacy line's JSON is found at the right offset.
 */
export function labelLinePrefix(line: string | undefined): string | null {
  if (line === undefined) return null;
  if (line.startsWith(LABELS_PREFIX)) return LABELS_PREFIX;
  if (line.startsWith(LEGACY_LABELS_PREFIX)) return LEGACY_LABELS_PREFIX;
  return null;
}
