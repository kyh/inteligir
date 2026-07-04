// Locate a checkbox in raw markdown by its ORDINAL among the file's task-list
// items. Parsed with the SAME remark-gfm the renderer's editor uses, so the
// count is structurally identical to the renderer's — no regex approximation
// that could disagree with the real parser on fenced/indented code, empty
// checkboxes, or nesting.
//
// SHARED COUNTING CONTRACT (kept in lockstep with block-list.tsx's `todoIndex`):
// both sides count exactly the GFM task-list items remark-gfm recognises — a
// checkbox with real content, checked or unchecked, at any nesting. A bare/empty
// checkbox, a plain bullet, and any checkbox-like line inside fenced OR indented
// code are NOT task items on either side. The renderer parses Plate nodes from
// the same markdown via the same remark-gfm, so the two agree by position with
// no text matching, and duplicate labels stay distinct.
//
// Heading + section are read at the located item as agent-prompt context only.

import type { Heading, ListItem, Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const processor = unified().use(remarkParse).use(remarkGfm);

const MAX_SECTION_LINES = 60;
// The list marker + checkbox prefix on a task line; what's left is the item text.
const MARKER = /^\s*[-*+]\s+\[[ xX]\]\s+/;

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

/** Find the `index`-th UNCHECKED checkbox in `raw` (per the counting contract
 * above). Returns null if there's no such checkbox or it's already checked
 * (stale) — the caller rejects rather than acting on the wrong/old line. */
export function findTaskLine(raw: string, index: number): TaskLineMatch | null {
  const lines = raw.split(/\r\n|\r|\n/);
  const items: ListItem[] = [];
  const headings: HeadingInfo[] = [];
  collect(processor.parse(raw), items, headings, lines);

  const item = items[index];
  if (!item?.position) return null;
  // The index-th task item. Reject if it's already checked (the doc drifted).
  if (item.checked === true) return null;

  const lineIndex = item.position.start.line - 1;
  const lineText = lines[lineIndex] ?? "";
  return {
    lineIndex,
    lineText,
    // Verbatim source text after the marker (inline markdown preserved).
    text: lineText.replace(MARKER, "").trim(),
    heading: nearestHeading(headings, lineIndex),
    section: sectionAround(lines, headings, lineIndex),
  };
}

/** Pre-order DFS collecting task-list items (`checked` is a boolean) and
 * headings in document order — the same order Plate lays them out, so ordinals
 * line up 1:1 with the renderer's `todoIndex`. */
function collect(node: Nodes, items: ListItem[], headings: HeadingInfo[], lines: string[]): void {
  if (node.type === "listItem" && typeof node.checked === "boolean") {
    items.push(node);
  } else if (node.type === "heading") {
    pushHeading(node, headings, lines);
  }
  if ("children" in node) {
    for (const child of node.children) collect(child, items, headings, lines);
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
 * heading below (exclusive), capped so a giant section doesn't flood the prompt.
 * Headings inside fenced/indented code aren't parsed as headings, so they can't
 * act as false boundaries. */
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
