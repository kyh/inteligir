// Locate a checkbox in raw markdown by its ORDINAL among the file's task-list
// items. The item lookup IS core's `scanTaskItems` — the projection's counting
// authority, the same counter behind the guarded toggle
// (guarded-line-edit's `toggleTaskAtOrdinal`) — so this locator can never
// drift from the index or the toggle. The renderer's `todoIndex`
// (todo-item.ts) counts the same items over the editor's parse of the same
// markdown (scanTaskItems reads the canonical flavor's grammar — no indented
// code, matching MDX), so ordinals agree by position with no text matching,
// and duplicate labels stay distinct. Frontmatter-awareness (a checkbox-shaped
// line inside a leading `---` block never counts) is scanTaskItems' own
// contract.
//
// Heading + section are read at the located item as agent-prompt context only
// — the local parse below serves ONLY that context, never the ordinal.

import type { Heading, Nodes } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { scanTaskItems } from "@repo/notes/knowledge/link-extract";

const processor = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm);

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

type HeadingInfo = { line: number; text: string };

/** Find the `ordinal`-th UNCHECKED checkbox in `raw` (scanTaskItems' counting
 * contract). Returns null if there's no such checkbox or it's already checked
 * (stale) — the caller rejects rather than acting on the wrong/old line. */
export function findTaskLine(raw: string, ordinal: number): TaskLineMatch | null {
  // `.find` — not `[ordinal]` — because an item scanTaskItems skipped (no
  // source position) still consumed its ordinal there.
  const task = scanTaskItems(raw).find((item) => item.ordinal === ordinal);
  if (task === undefined) return null;
  // The ordinal-th task item. Reject if it's already checked (the doc drifted).
  if (task.checked) return null;

  // `raw`/`text` come straight off the task (same line-split rule as below);
  // the extra parse here only collects headings for the prompt context.
  const lines = raw.split(/\r\n|\r|\n/);
  const headings: HeadingInfo[] = [];
  collectHeadings(processor.parse(raw), headings, lines);
  const lineIndex = task.line - 1;
  return {
    lineIndex,
    lineText: task.raw,
    text: task.text,
    heading: nearestHeading(headings, lineIndex),
    section: sectionAround(lines, headings, lineIndex),
  };
}

/** Pre-order DFS collecting headings in document order, for the prompt
 * context. Headings inside fenced/indented code aren't parsed as headings,
 * so they can't act as false boundaries. */
function collectHeadings(node: Nodes, headings: HeadingInfo[], lines: string[]): void {
  if (node.type === "heading") {
    pushHeading(node, headings, lines);
  }
  if ("children" in node) {
    for (const child of node.children) collectHeadings(child, headings, lines);
  }
}

function pushHeading(node: Heading, headings: HeadingInfo[], lines: string[]): void {
  if (!node.position) return;
  const line = node.position.start.line - 1;
  headings.push({ line, text: (lines[line] ?? "").replace(/^\s*#{1,6}\s+/, "").trim() });
}

function nearestHeading(headings: HeadingInfo[], lineIndex: number): string | null {
  let best: HeadingInfo | undefined;
  for (const h of headings) {
    if (h.line < lineIndex && (best === undefined || h.line > best.line)) best = h;
  }
  return best ? best.text || null : null;
}

/** The lines from the nearest heading at/above the item (inclusive) to the next
 * heading below (exclusive), capped so a giant section doesn't flood the prompt. */
function sectionAround(lines: string[], headings: HeadingInfo[], lineIndex: number): string {
  let start = 0;
  for (const h of headings) {
    if (h.line <= lineIndex && h.line > start) start = h.line;
  }
  let end = lines.length;
  for (const h of headings) {
    if (h.line > start && h.line < end) end = h.line;
  }
  if (end - start > MAX_SECTION_LINES) end = start + MAX_SECTION_LINES;
  return lines.slice(start, end).join("\n").trim();
}
