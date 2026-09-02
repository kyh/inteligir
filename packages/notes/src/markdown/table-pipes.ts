// stock gfm splits `| {{5|5}} |` across two cells, so pipes inside `{{…}}` on table-shaped lines
// are escaped to `\|` ahead of micromark; idempotent over canonical output. not applied to the
// knowledge scan: its tree positions drive rename byte-surgery and this pass shifts columns.

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
  // only a pipe outside every pill marks a cell boundary; a lone pill on a prose line keeps its bytes.
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
