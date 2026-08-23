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

import { activeLineMask, codeSpanRanges, inAnyRange, isEscapedAt } from "./line-scan";
import type { Range } from "./line-scan";

const FORMULA_SPAN_RE = /\{\{[^{}\n]*\}\}/g;

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
export function escapePillPipesInTables(md: string): string {
  if (!md.includes("{{")) return md;
  const lines = md.split("\n");
  const active = activeLineMask(lines);
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || active[i] !== true) continue;
    const escaped = escapeLine(line);
    if (escaped !== line) {
      lines[i] = escaped;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : md;
}
