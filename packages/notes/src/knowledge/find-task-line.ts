// Locate a checkbox in raw markdown by its ORDINAL among the file's task-list
// items. The item lookup IS core's `scanTaskItems` — the projection's counting
// authority, the same counter behind the guarded toggle
// (guarded-line-edit's `toggleTaskAtOrdinal`) — so this locator can never
// drift from the index or the toggle. The editor's `todoIndex`
// (todo-item.ts) counts the same items over the editor's parse of the same
// markdown (scanTaskItems reads the canonical flavor's grammar — no indented
// code, matching MDX), so ordinals agree by position with no text matching,
// and duplicate labels stay distinct. Frontmatter-awareness (a checkbox-shaped
// line inside a leading `---` block never counts) is scanTaskItems' own
// contract.
//
// The heading is read at the located item as agent-prompt context only — the
// local parse below serves ONLY that context, never the ordinal.

import type { Heading, Nodes } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { scanTaskItems } from "./link-extract";

const processor = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm);

export type TaskLineMatch = {
  /** The full original line (e.g. "- [ ] book the flight"). */
  lineText: string;
  /** The item text (after `- [ ] `), for the agent prompt. */
  text: string;
  /** Nearest heading above the line, or null. */
  heading: string | null;
};

type HeadingInfo = { line: number; text: string };

/**
 * Find the `ordinal`-th UNCHECKED checkbox in `raw` (scanTaskItems' counting
 * contract). Returns null if there's no such checkbox or it's already checked.
 *
 * REFUSING A CHECKED ITEM IS THIS LOCATOR'S OWN RULE, not the ordinal's, and it
 * is the one place it deliberately disagrees with `toggleTaskAtOrdinal`, which
 * accepts either state off the identical ordinal. The two answer different
 * questions: a toggle must reach a checked box, because unticking one is half
 * of what toggling means; delegation must not, because handing a done task to
 * an agent is work nobody asked for and the agent's first act would be to tick
 * a box that is already ticked. So the difference is the FEATURE, and the
 * shared half — which item the ordinal names — stays `scanTaskItems` for both.
 */
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
  return {
    lineText: task.raw,
    text: task.text,
    heading: nearestHeading(headings, task.line - 1),
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
