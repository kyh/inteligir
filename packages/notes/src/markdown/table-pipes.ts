// stock gfm splits `| {{5|5}} |` across two cells, so pipes inside `{{…}}` on table-shaped lines
// are escaped to `\|` ahead of micromark; idempotent over canonical output. not applied to the
// knowledge scan: its tree positions drive rename byte-surgery and this pass shifts columns.

import { codeSpanRanges, inAnyRange, isEscapedAt } from "./line-scan";
import type { Range } from "./line-scan";
import { literalRanges } from "./verbatim-spans";

const FORMULA_SPAN_RE = /\{\{[^{}\n]*\}\}/gu;

const hasBarePipe = (text: string, skip: readonly Range[]): boolean => {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "|" && !isEscapedAt(text, i) && !inAnyRange(skip, i)) {
      return true;
    }
  }
  return false;
};

// the pills on a table-shaped line whose pipes still need escaping, in line columns
const pillsToEscape = (line: string): Range[] => {
  if (!line.includes("{{") || !line.includes("|")) {
    return [];
  }
  const codeRanges = codeSpanRanges(line);
  const pillRanges: Range[] = [];
  for (const match of line.matchAll(FORMULA_SPAN_RE)) {
    const range = { end: match.index + match[0].length, start: match.index };
    if (!inAnyRange(codeRanges, range.start) && !inAnyRange(codeRanges, range.end - 1)) {
      pillRanges.push(range);
    }
  }
  // only a pipe outside every pill marks a cell boundary; a lone pill on a prose line keeps its bytes.
  if (pillRanges.length === 0 || !hasBarePipe(line, pillRanges)) {
    return [];
  }
  return pillRanges.filter((pill) => hasBarePipe(line.slice(pill.start, pill.end), []));
};

const escapePill = (raw: string): string => {
  let escaped = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    escaped += ch === "|" && !isEscapedAt(raw, i) ? "\\|" : ch;
  }
  return escaped;
};

const overlaps = (a: Range, b: Range): boolean => a.start < b.end && b.start < a.end;

// a line cannot tell a blockquoted fence, a nested one or a `$$` block from a table row, so the
// grammar is asked where the literal bytes are, and only when there is an edit to veto.
export const escapePillPipesInTables = (md: string): string => {
  if (!md.includes("{{")) {
    return md;
  }
  const pending: Range[] = [];
  let lineStart = 0;
  for (const line of md.split("\n")) {
    for (const pill of pillsToEscape(line)) {
      pending.push({ end: lineStart + pill.end, start: lineStart + pill.start });
    }
    lineStart += line.length + 1;
  }
  if (pending.length === 0) {
    return md;
  }
  const literal = literalRanges(md);
  if (literal === null) {
    return md;
  }
  const edits = pending.filter((pill) => !literal.some((range) => overlaps(pill, range)));
  if (edits.length === 0) {
    return md;
  }
  let out = "";
  let cursor = 0;
  for (const pill of edits) {
    out += md.slice(cursor, pill.start) + escapePill(md.slice(pill.start, pill.end));
    cursor = pill.end;
  }
  return out + md.slice(cursor);
};
