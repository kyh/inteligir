// Moss leaves a formula pill's pipes RAW inside GFM table cells (its cell
// splitter is formula-aware); our parse is stock GFM, so `| {{5|5}} |` would
// split the pill across two cells. This pre-parse pass escapes pipes that sit
// inside `{{…}}` spans on table-shaped lines to `\|` — the form the GFM cell
// reader unescapes and our serializer already emits — so Moss-written bytes
// parse to the same tree ours do. Idempotent over canonical output (already-
// escaped pipes are left alone), which keeps the fixpoint a fixpoint.
//
// Deliberately NOT applied to the knowledge scan (scan-parse.ts): its tree
// positions drive rename byte-surgery, and this pass shifts columns.

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const FORMULA_SPAN_RE = /\{\{[^{}\n]*\}\}/g;

type Range = { start: number; end: number };

function isEscapedAt(line: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

/** CommonMark code spans on one line: a backtick run pairs with the next run
 * of the SAME length. Pills inside them are literal text and must not gain
 * backslashes (a backslash is literal inside a code span). */
function codeSpanRanges(line: string): Range[] {
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

function inAnyRange(ranges: readonly Range[], index: number): boolean {
  return ranges.some((r) => index >= r.start && index < r.end);
}

function escapeLine(line: string): string {
  if (!line.includes("{{") || !line.includes("|")) return line;
  const codeRanges = codeSpanRanges(line);
  const pillRanges: Range[] = [];
  for (const match of line.matchAll(FORMULA_SPAN_RE)) {
    const range = { start: match.index, end: match.index + match[0].length };
    if (!inAnyRange(codeRanges, range.start) && !inAnyRange(codeRanges, range.end - 1)) {
      pillRanges.push(range);
    }
  }
  if (pillRanges.length === 0) return line;
  // Only a pipe OUTSIDE every pill marks a table cell boundary: a lone pill
  // on a prose line has nothing to protect and keeps its bytes.
  let hasCellBoundary = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && !isEscapedAt(line, i) && !inAnyRange(pillRanges, i)) {
      hasCellBoundary = true;
      break;
    }
  }
  if (!hasCellBoundary) return line;
  let out = "";
  let cursor = 0;
  for (const pill of pillRanges) {
    out += line.slice(cursor, pill.start);
    const raw = line.slice(pill.start, pill.end);
    let escaped = "";
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      escaped += ch === "|" && !isEscapedAt(raw, i) ? "\\|" : ch;
    }
    out += escaped;
    cursor = pill.end;
  }
  return out + line.slice(cursor);
}

/** Escape raw pipes inside `{{…}}` pills on table-shaped lines, skipping the
 * frontmatter block and code fences (their bytes are verbatim by contract). */
export function escapeMossPipesInTables(md: string): string {
  if (!md.includes("{{")) return md;
  const lines = md.split("\n");
  let frontmatterEnd = -1;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close !== -1) frontmatterEnd = close;
  }
  let fence: { char: string; length: number } | null = null;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (i <= frontmatterEnd) continue;
    if (fence !== null) {
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
      if (marker !== undefined) fence = { char: marker, length: open[1].length };
      continue;
    }
    const escaped = escapeLine(line);
    if (escaped !== line) {
      lines[i] = escaped;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : md;
}
