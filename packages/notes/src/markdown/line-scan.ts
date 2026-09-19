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

const FENCE_OPEN_RE = /^ {0,3}(?<opener>`{3,}|~{3,})/u;

export const activeLineMask = (lines: readonly string[]): boolean[] => {
  const mask = Array.from({ length: lines.length }, () => true);
  let frontmatterEnd = -1;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close !== -1) {
      frontmatterEnd = close;
    }
  }
  let fence: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    if (i <= frontmatterEnd) {
      mask[i] = false;
      continue;
    }
    if (fence !== null) {
      mask[i] = false;
      const trimmed = line.trim();
      if (
        trimmed.startsWith(fence.char.repeat(fence.length)) &&
        trimmed.replaceAll(fence.char, "") === ""
      ) {
        fence = null;
      }
      continue;
    }
    const opener = FENCE_OPEN_RE.exec(line)?.groups?.opener;
    if (opener !== undefined) {
      const [marker] = opener;
      if (marker !== undefined) {
        fence = { char: marker, length: opener.length };
        mask[i] = false;
      }
    }
  }
  return mask;
};
