export interface Range {
  start: number;
  end: number;
}

export const isEscapedAt = (line: string, index: number): boolean => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

// a pipe with no backslash before it would end a table cell; one with its escape already stays
export const escapeBarePipes = (raw: string): string => {
  let escaped = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    escaped += ch === "|" && !isEscapedAt(raw, i) ? "\\|" : ch;
  }
  return escaped;
};

// a span the grammar holds literally writes its pipes as a table row needs them: gfm pairs a row's
// backslashes, so `\\|` is an escaped backslash and then a divider. a pipe the span keeps behind a
// backslash of its own has no spelling that reads back through `readCellPipes`, so each span names
// what stands for it.
export const escapeCellPipes = (raw: string, ownEscape: string): string =>
  raw.replaceAll(/\\[\s\S]|\|/gu, (run) => {
    if (run === "|") {
      return String.raw`\|`;
    }
    return run === String.raw`\|` ? ownEscape : run;
  });

// gfm's reading of a cell's inline code, which a literal span of ours shares
export const readCellPipes = (raw: string): string =>
  raw.replaceAll(/\\[\\|]/gu, (run) => (run === String.raw`\|` ? "|" : run));

// a backtick run pairs with the next run of the same length (CommonMark).
export const codeSpanRanges = (line: string): Range[] => {
  const runs: Range[] = [];
  for (let i = 0; i < line.length;) {
    if (line[i] !== "`") {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (end < line.length && line[end] === "`") {
      end += 1;
    }
    runs.push({ end, start: i });
    i = end;
  }
  const ranges: Range[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    const open = runs[i];
    if (open === undefined) {
      continue;
    }
    const length = open.end - open.start;
    for (let j = i + 1; j < runs.length; j += 1) {
      const close = runs[j];
      if (close === undefined || close.end - close.start !== length) {
        continue;
      }
      ranges.push({ end: close.end, start: open.start });
      i = j;
      break;
    }
  }
  return ranges;
};

export const inAnyRange = (ranges: readonly Range[], index: number): boolean =>
  ranges.some((r) => index >= r.start && index < r.end);
