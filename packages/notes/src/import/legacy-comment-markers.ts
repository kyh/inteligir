// Moss's pre-modern comment anchors: `{%c:ids%}` opens a range that the next
// `{%/c%}` closes (LIFO when nested). The import rewrites PAIRED markers to
// the modern `%%m:ids:start%%`/`%%m:ids:end%%` form and leaves any unpaired
// edge verbatim — Moss itself converts a close-less open, but the dangling
// start marker that produces is exactly what our anchored-thread derivation
// calls malformed, so pairing is required before bytes change.

import { activeLineMask, codeSpanRanges, inAnyRange } from "../markdown/line-scan";

const LEGACY_TOKEN_RE = /\{%c:\s*([A-Za-z0-9_,\-\s]+?)\s*%\}|\{%\/c%\}/g;

type LegacyToken = {
  line: number;
  start: number;
  end: number;
  /** null for a close marker. */
  ids: string[] | null;
};

/** Moss's own id-list parse: split on commas, trim, drop empties and dupes. */
function parseIds(raw: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const id = entry.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export type LegacyMarkerResult = {
  body: string;
  /** Paired open/close marker pairs rewritten. */
  migrated: number;
  /** Legacy edges left verbatim: closes with no open, opens never closed,
   * opens whose id list parsed empty. */
  unpaired: number;
};

export function migrateLegacyCommentMarkers(md: string): LegacyMarkerResult {
  if (!md.includes("{%")) {
    return { body: md, migrated: 0, unpaired: 0 };
  }
  const lines = md.split("\n");
  const active = activeLineMask(lines);
  const tokens: LegacyToken[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || active[i] !== true || !line.includes("{%")) continue;
    const codeRanges = codeSpanRanges(line);
    for (const match of line.matchAll(LEGACY_TOKEN_RE)) {
      if (inAnyRange(codeRanges, match.index)) continue;
      tokens.push({
        line: i,
        start: match.index,
        end: match.index + match[0].length,
        ids: match[1] === undefined ? null : parseIds(match[1]),
      });
    }
  }
  if (tokens.length === 0) {
    return { body: md, migrated: 0, unpaired: 0 };
  }

  // Pass 1: pair opens and closes LIFO over the whole document. An open with
  // an empty id list never enters the stack (Moss leaves it verbatim too).
  const replacement = new Map<number, string>();
  const stack: number[] = [];
  let unpaired = 0;
  let migrated = 0;
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    if (token === undefined) continue;
    if (token.ids !== null) {
      if (token.ids.length === 0) {
        unpaired++;
        continue;
      }
      stack.push(t);
      continue;
    }
    const openIndex = stack.pop();
    const open = openIndex === undefined ? undefined : tokens[openIndex];
    if (openIndex === undefined || open === undefined || open.ids === null) {
      unpaired++;
      continue;
    }
    const joined = open.ids.join(",");
    replacement.set(openIndex, `%%m:${joined}:start%%`);
    replacement.set(t, `%%m:${joined}:end%%`);
    migrated++;
  }
  unpaired += stack.length;
  if (replacement.size === 0) {
    return { body: md, migrated: 0, unpaired };
  }

  // Pass 2: splice per line, right-to-left so earlier offsets stay valid.
  const byLine = new Map<number, Array<{ start: number; end: number; text: string }>>();
  for (const [index, text] of replacement) {
    const token = tokens[index];
    if (token === undefined) continue;
    const list = byLine.get(token.line) ?? [];
    list.push({ start: token.start, end: token.end, text });
    byLine.set(token.line, list);
  }
  for (const [lineIndex, edits] of byLine) {
    let line = lines[lineIndex];
    if (line === undefined) continue;
    for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
      line = line.slice(0, edit.start) + edit.text + line.slice(edit.end);
    }
    lines[lineIndex] = line;
  }
  return { body: lines.join("\n"), migrated, unpaired };
}
