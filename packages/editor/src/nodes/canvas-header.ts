export const GRID_HEADER = "[inteligir:grid:v2]";
export const LABELS_PREFIX = "[inteligir:labels:";

export const CANVAS_COLS = 120;
export const CANVAS_ROWS = 60;

export const isGridHeader = (line: string | undefined) => line?.trim() === GRID_HEADER;

export const isLabelsLine = (line: string | undefined): line is string =>
  line?.startsWith(LABELS_PREFIX) ?? false;
