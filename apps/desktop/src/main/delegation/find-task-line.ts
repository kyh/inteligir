// Locate a checkbox line in raw markdown by its ORDINAL — the index of the
// checkbox among all `- [ ]` / `- [x]` task items in the file (document order).
// The renderer counts the same items in its parsed tree, so the two agree
// without any text/markdown normalization, and duplicate item labels are
// distinguished by position. The heading + section are read at that line purely
// as context for the delegated agent's prompt. Pure + line-based, so it's
// testable in isolation.

// GFM accepts `-`, `*`, and `+` bullet markers; `[ ]` unchecked, `[x]` checked.
const TASK_LINE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

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

/** Find the `index`-th UNCHECKED checkbox in `raw` (counting all checkboxes,
 * checked or not, in document order; checkbox-like lines inside fenced code are
 * skipped). Returns null if there's no such checkbox or it's already checked
 * (stale) — the caller rejects rather than acting on the wrong/old line. */
export function findTaskLine(raw: string, index: number): TaskLineMatch | null {
  // Normalize CRLF/CR so Windows-authored files match (the `$` line anchor
  // wouldn't otherwise sit before the lone `\r`).
  const lines = raw.split(/\r\n|\r|\n/);

  let count = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

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
      heading: nearestHeading(lines, i),
      section: sectionAround(lines, i),
    };
  }
  return null;
}

function nearestHeading(lines: string[], from: number): string | null {
  for (let i = from - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    const h = HEADING.exec(line);
    if (h) return (h[1] ?? "").trim() || null;
  }
  return null;
}

/** The lines from the nearest heading above (inclusive) to the next heading
 * below (exclusive), capped so a giant section doesn't flood the prompt. */
function sectionAround(lines: string[], from: number): string {
  let start = 0;
  for (let i = from; i >= 0; i--) {
    const line = lines[i];
    if (line !== undefined && HEADING.test(line)) {
      start = i;
      break;
    }
  }
  let end = lines.length;
  for (let i = from + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && HEADING.test(line)) {
      end = i;
      break;
    }
  }
  if (end - start > MAX_SECTION_LINES) end = start + MAX_SECTION_LINES;
  return lines.slice(start, end).join("\n").trim();
}
