// Line-level scanning shared by the pre-parse passes (table-pipe escaping,
// the Moss import migrations): which lines are ACTIVE text — outside the
// frontmatter block and code fences, whose bytes are verbatim by contract —
// and which columns of a line sit inside CommonMark code spans.

export type Range = { start: number; end: number };

export function isEscapedAt(line: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

/** CommonMark code spans on one line: a backtick run pairs with the next run
 * of the SAME length. Content inside them is literal text. */
export function codeSpanRanges(line: string): Range[] {
  const runs: Range[] = [];
  for (let i = 0; i < line.length;) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < line.length && line[end] === "`") end++;
    runs.push({ start: i, end });
    i = end;
  }
  const ranges: Range[] = [];
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i];
    if (open === undefined) continue;
    const length = open.end - open.start;
    for (let j = i + 1; j < runs.length; j++) {
      const close = runs[j];
      if (close === undefined || close.end - close.start !== length) continue;
      ranges.push({ start: open.start, end: close.end });
      i = j;
      break;
    }
  }
  return ranges;
}

export function inAnyRange(ranges: readonly Range[], index: number): boolean {
  return ranges.some((r) => index >= r.start && index < r.end);
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Which of `lines` are active text: false for the frontmatter block and every
 * line of a code fence (opening and closing markers included). The fence walk
 * is the one the table-pipe pass established — indent up to 3, a closing line
 * is the same character at least as long with nothing else on it.
 */
export function activeLineMask(lines: readonly string[]): boolean[] {
  const mask = Array.from({ length: lines.length }, () => true);
  let frontmatterEnd = -1;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close !== -1) frontmatterEnd = close;
  }
  let fence: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
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
    const open = FENCE_OPEN_RE.exec(line);
    if (open !== null && open[1] !== undefined) {
      const marker = open[1][0];
      if (marker !== undefined) {
        fence = { char: marker, length: open[1].length };
        mask[i] = false;
      }
    }
  }
  return mask;
}
