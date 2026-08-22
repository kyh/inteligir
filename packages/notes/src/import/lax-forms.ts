// Moss's parsers tolerate whitespace our strict grammar refuses: spacey
// marker id lists (`%%m: a, b :start%%`), `::: tabs` / `===  Label` /
// trailing-space `:::` in tab groups. The import normalizes those spellings
// so the live grammar can stay strict — the corpus-scan answer #600 records.

import { activeLineMask, codeSpanRanges, inAnyRange } from "../markdown/line-scan";

const LAX_MARKER_RE = /%%m:\s*([A-Za-z0-9_,\-\s]+?)\s*:(start|end)%%/g;
const STRICT_IDS_RE = /^[A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*$/;

function normalizeIds(raw: string): string | null {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const id = entry.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return null;
  const joined = ids.join(",");
  return STRICT_IDS_RE.test(joined) ? joined : null;
}

export type LaxNormalizeResult = { body: string; normalized: number };

/** Rewrite whitespace-lax modern markers to the strict spelling. A marker the
 * strict grammar already accepts is byte-identical after this and does not
 * count as normalized. */
export function normalizeLaxMarkers(md: string): LaxNormalizeResult {
  if (!md.includes("%%m:")) return { body: md, normalized: 0 };
  const lines = md.split("\n");
  const active = activeLineMask(lines);
  let normalized = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || active[i] !== true || !line.includes("%%m:")) continue;
    const codeRanges = codeSpanRanges(line);
    const next = line.replace(
      LAX_MARKER_RE,
      (match, rawIds: string, edge: string, offset: number) => {
        if (inAnyRange(codeRanges, offset)) return match;
        const ids = normalizeIds(rawIds);
        if (ids === null) return match;
        const strict = `%%m:${ids}:${edge}%%`;
        if (strict !== match) normalized++;
        return strict;
      },
    );
    lines[i] = next;
  }
  return { body: lines.join("\n"), normalized };
}

const LAX_TABS_OPEN_RE = /^:::\s+tabs\s*$/;
const LAX_TABS_CLOSE_RE = /^:::\s+$/;
const LAX_TAB_LABEL_RE = /^===\s{2,}(\S.*?)\s*$/;
const STRICT_TABS_OPEN = ":::tabs";
const ANY_TABS_OPEN_RE = /^:::\s*tabs\s*$/;
const ANY_DIRECTIVE_OPEN_RE = /^:::\S/;

/**
 * Normalize tab-group spellings, but only INSIDE a group: a bare `===` run
 * outside one is a setext underline, and a stray `::: ` is prose. The walk
 * mirrors the tabs grammar — an open at nesting depth 0, labels at depth 1,
 * `:::` lines adjusting depth for nested directives.
 */
export function normalizeLaxTabs(md: string): LaxNormalizeResult {
  if (!md.includes(":::")) return { body: md, normalized: 0 };
  const lines = md.split("\n");
  const active = activeLineMask(lines);
  let normalized = 0;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || active[i] !== true) continue;
    if (depth === 0) {
      if (ANY_TABS_OPEN_RE.test(line)) {
        depth = 1;
        if (LAX_TABS_OPEN_RE.test(line)) {
          lines[i] = STRICT_TABS_OPEN;
          normalized++;
        }
      }
      continue;
    }
    if (line.trim() === ":::" || LAX_TABS_CLOSE_RE.test(line)) {
      depth--;
      if (line !== ":::" && depth === 0) {
        lines[i] = ":::";
        normalized++;
      }
      continue;
    }
    if (ANY_DIRECTIVE_OPEN_RE.test(line) || ANY_TABS_OPEN_RE.test(line)) {
      depth++;
      continue;
    }
    if (depth === 1) {
      const label = LAX_TAB_LABEL_RE.exec(line);
      if (label !== null && label[1] !== undefined) {
        lines[i] = `=== ${label[1]}`;
        normalized++;
      }
    }
  }
  return { body: lines.join("\n"), normalized };
}
