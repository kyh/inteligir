// Locate a checkbox line in raw markdown by its ORDINAL — the index of the
// checkbox among all `- [ ]` / `- [x]` task items in the file (document order).
//
// SHARED COUNTING CONTRACT (must stay in lockstep with block-list.tsx's
// `todoIndex` on the renderer side, or the agent edits the wrong task):
//   - count EVERY task item, checked or unchecked, at any indent / nesting;
//   - `-`, `*`, `+` are all valid bullet markers;
//   - checkbox-like lines inside fenced code (``` / ~~~) DON'T count.
// The renderer counts todo nodes in its parsed tree, which match these lines
// 1:1 because the tree is parsed from the same markdown — so the two agree by
// position with no text matching, and duplicate labels stay distinct.
//
// Heading + section are read at the located line as agent-prompt context only.
// Pure + line-based, so it's testable in isolation.

// GFM accepts `-`, `*`, `+` bullet markers; `[ ]` unchecked, `[x]` checked. The
// text must be NON-EMPTY (`\S`): Plate/remark-gfm only treats a checkbox with
// real content as a todo — a bare `- [ ] ` deserializes to a plain bullet, not a
// todo node — so counting empty checkboxes here would desync the ordinal from
// the renderer's `todoIndex` and mis-target delegation.
const TASK_LINE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(\S.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;

const MAX_SECTION_LINES = 60;

export type TaskLineMatch = {
  /** Zero-based index of the matched line in the file. */
  lineIndex: number;
  /** The full original line (e.g. "- [ ] book the flight"). */
  lineText: string;
  /** The item text (after `- [ ] `), for the agent prompt. */
  text: string;
  /** Nearest heading above the line, or null. */
  heading: string | null;
  /** The markdown section the task lives in (heading → next heading / cap),
   * for the agent's prompt context. */
  section: string;
};

/** Find the `index`-th UNCHECKED checkbox in `raw` (per the counting contract
 * above). Returns null if there's no such checkbox or it's already checked
 * (stale) — the caller rejects rather than acting on the wrong/old line. */
export function findTaskLine(raw: string, index: number): TaskLineMatch | null {
  // Normalize CRLF/CR so Windows-authored files match (the `$` line anchor
  // wouldn't otherwise sit before the lone `\r`).
  const lines = raw.split(/\r\n|\r|\n/);
  const fenced = fenceMask(lines);

  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || fenced[i]) continue;
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    if (count !== index) {
      count++;
      continue;
    }
    // The index-th checkbox. Reject if it's already checked (the doc drifted).
    if ((m[2] ?? " ") !== " ") return null;
    return {
      lineIndex: i,
      lineText: line,
      text: (m[3] ?? "").trim(),
      heading: nearestHeading(lines, fenced, i),
      section: sectionAround(lines, fenced, i),
    };
  }
  return null;
}

/** Per-line "is inside a fenced code block" mask. A fence opens on ``` / ~~~
 * (3+) and closes only on a bare fence of the SAME char and at least the same
 * length (CommonMark), so mixed/indented markers inside a block don't desync. */
function fenceMask(lines: string[]): boolean[] {
  const mask: boolean[] = Array.from({ length: lines.length }, () => false);
  let open: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = FENCE.exec(line);
    if (open === null) {
      if (m) {
        open = m[2] ?? "";
        mask[i] = true;
      }
      continue;
    }
    mask[i] = true; // every line inside the block, incl. the closing fence
    if (m) {
      const run = m[2] ?? "";
      const info = (m[3] ?? "").trim();
      if (run[0] === open[0] && run.length >= open.length && info === "") open = null;
    }
  }
  return mask;
}

function nearestHeading(lines: string[], fenced: boolean[], from: number): string | null {
  for (let i = from - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined || fenced[i]) continue;
    const h = HEADING.exec(line);
    if (h) return (h[1] ?? "").trim() || null;
  }
  return null;
}

/** The lines from the nearest heading above (inclusive) to the next heading
 * below (exclusive), capped so a giant section doesn't flood the prompt.
 * Heading-like lines inside fenced code are ignored as boundaries. */
function sectionAround(lines: string[], fenced: boolean[], from: number): string {
  const isHeading = (i: number) => {
    const line = lines[i];
    return line !== undefined && !fenced[i] && HEADING.test(line);
  };
  let start = 0;
  for (let i = from; i >= 0; i--) {
    if (isHeading(i)) {
      start = i;
      break;
    }
  }
  let end = lines.length;
  for (let i = from + 1; i < lines.length; i++) {
    if (isHeading(i)) {
      end = i;
      break;
    }
  }
  if (end - start > MAX_SECTION_LINES) end = start + MAX_SECTION_LINES;
  return lines.slice(start, end).join("\n").trim();
}
