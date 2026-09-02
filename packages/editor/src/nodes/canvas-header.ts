// the parser, the sketch writer and the slash seed must agree on these spellings.

export const GRID_HEADER = "[inteligir:grid:v2]";
export const LABELS_PREFIX = "[inteligir:labels:";

export function isGridHeader(line: string | undefined): boolean {
  return line?.trim() === GRID_HEADER;
}

export function labelLinePrefix(line: string | undefined): string | null {
  if (line === undefined) return null;
  if (line.startsWith(LABELS_PREFIX)) return LABELS_PREFIX;
  return null;
}
