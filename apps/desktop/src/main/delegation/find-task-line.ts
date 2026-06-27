// Locate an unchecked checkbox line in raw markdown by its item text, with the
// heading it lives under and the surrounding section as context for the agent.
// Pure + line-based so the delegated agent's "find and check off this task"
// instruction is anchored to a concrete, testable locator.

// GFM accepts `-`, `*`, and `+` as bullet markers.
const TASK_LINE = /^(\s*)[-*+]\s+\[ \]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;

const MAX_SECTION_LINES = 60;

export type TaskLineMatch = {
  /** Zero-based index of the matched line. */
  lineIndex: number;
  /** The full original line text (e.g. "- [ ] book the flight"). */
  lineText: string;
  /** Nearest heading text above the line, or null. */
  heading: string | null;
  /** The markdown section the task lives in (heading → next heading / cap),
   * for the agent's prompt context. */
  section: string;
};

/** Find an UNCHECKED `- [ ] <text>` line whose item text matches `text`
 * (whitespace-trimmed). When `heading` is given (the nearest heading above the
 * checkbox the user clicked), the occurrence under that heading is preferred so
 * duplicate item text across sections resolves to the right checkbox; it falls
 * back to the first text match if none sits under that heading. Returns null
 * when no unchecked line matches the text at all. */
export function findTaskLine(
  raw: string,
  text: string,
  heading?: string | null,
): TaskLineMatch | null {
  const target = text.trim();
  // Normalize CRLF/CR so Windows-authored files match (the `$` line anchor
  // wouldn't otherwise sit before the lone `\r`).
  const lines = raw.split(/\r\n|\r|\n/);

  let firstTextMatch: TaskLineMatch | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    // The renderer's `text` is Plate's plain item text; the raw line may still
    // carry inline markdown (`- [ ] **buy** milk`), so normalize before compare.
    if (stripInline((m[2] ?? "").trim()) !== target) continue;

    const match: TaskLineMatch = {
      lineIndex: i,
      lineText: line,
      heading: nearestHeading(lines, i),
      section: sectionAround(lines, i),
    };
    if (firstTextMatch === null) firstTextMatch = match;
    // No heading disambiguation requested → first text match. Otherwise return
    // the occurrence under the requested heading.
    if (heading === undefined || match.heading === heading) return match;
  }
  return firstTextMatch;
}

// Reduce inline markdown to the plain text Plate's elementText yields, so the
// renderer's anchors (plain item text + heading) match lines resolved from raw
// markdown. Asterisk emphasis works intraword in GFM (`a*b*c`), but underscore
// emphasis only at word boundaries — so `snake_case` and a lone `*` survive,
// while `**bold**` / `_em_` / links / code unwrap.
function stripInline(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/(?<![A-Za-z0-9])__(.+?)__(?![A-Za-z0-9])/g, "$1") // __bold__
    .replace(/\*(.+?)\*/g, "$1") // *italic*
    .replace(/(?<![A-Za-z0-9])_(.+?)_(?![A-Za-z0-9])/g, "$1") // _italic_
    .replace(/~~(.+?)~~/g, "$1") // ~~strike~~
    .replace(/`([^`]+)`/g, "$1") // `code`
    .trim();
}

function plainHeading(raw: string): string | null {
  const t = stripInline(raw);
  return t === "" ? null : t;
}

function nearestHeading(lines: string[], from: number): string | null {
  for (let i = from - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    const h = HEADING.exec(line);
    if (h) return plainHeading(h[1] ?? "");
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
