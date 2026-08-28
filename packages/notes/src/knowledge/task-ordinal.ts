// ---------------------------------------------------------------------------
// THE TASK ORDINAL — the one count of a doc's GFM checkboxes.
//
// A checkbox in a markdown file has no id, so anything that points at one
// points at its POSITION among the file's task items: document pre-order,
// counted over the canonical grammar (../markdown/scan-parse), checked items
// included. That position IS the index in the array returned here.
//
// So the COUNT lives here, once, and no surface may bring its own. The editor
// draws its checkboxes off the other plugin list over the same micromark
// (../markdown/parse), and the two agree only while both disable
// `codeIndented` and `htmlFlow` — pinned in ../__tests__/task-ordinal.test.ts,
// which counts the same docs through both parses.
// ---------------------------------------------------------------------------

import type { ListItem, Nodes } from "mdast";

import { parseScan } from "../markdown/scan-parse";
import { splitLines } from "./source-lines";

/** One GFM task item (`- [ ]` checkbox), as the projection records it. */
export type ExtractedTask = {
  checked: boolean;
  /** The item text after the checkbox marker, trimmed (inline md verbatim). */
  text: string;
  /** 1-based source line the item starts on. */
  line: number;
};

// The checkbox marker on a GFM task line: indent + blockquote markers + list
// marker + `[`, the state char, `]`, then whitespace. Bullets, ordered markers
// (`1.` / `2)`) and `> ` prefixes all carry live checkboxes in the editor, so
// the grammar names them all — a narrower one would leave half a marker in the
// text of a line the parser just accepted.
const CHECKBOX_MARKER_RE = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\](?=\s)/;

// A raw line this grammar refuses (an item shape only the parser accepts) keeps
// its full text rather than a half-stripped one.
function taskTextOf(raw: string): string {
  const marker = CHECKBOX_MARKER_RE.exec(raw);
  return (marker === null ? raw : raw.slice(marker[0].length)).trim();
}

/** Every GFM task item in `source`, in ordinal order — the counting authority.
 * The `tasks: false` frontmatter opt-out is deliberately NOT applied: it hides
 * tasks from a VIEW, while the editor renders every checkbox in the buffer
 * whatever the frontmatter says, so the count the two are compared on must
 * ignore it too. `scanDoc` applies the opt-out on top of this. */
export function scanTaskItems(source: string): ExtractedTask[] {
  return tasksInTree(parseScan(source), source);
}

/** The same count over a tree the caller already parsed — how `scanDoc` keeps
 * its one-parse-per-doc promise without owning a second counter. */
export function tasksInTree(tree: Nodes, source: string): ExtractedTask[] {
  const items: Array<{ item: ListItem; checked: boolean }> = [];
  collectTaskItems(tree, items);
  if (items.length === 0) return [];
  const lines = splitLines(source);
  const tasks: ExtractedTask[] = [];
  for (const { item, checked } of items) {
    const startLine = item.position?.start.line;
    // Both parses position every item; a synthetic tree names no line to read
    // the item's text from, so there is nothing here to count.
    if (startLine === undefined) continue;
    tasks.push({ checked, text: taskTextOf(lines[startLine - 1] ?? ""), line: startLine });
  }
  return tasks;
}

// ---- counting ---------------------------------------------------------------

/** Pre-order DFS collecting task-list items (`checked` is a boolean) in
 * document order. A plain bullet in a mixed list has `checked: null` and is not
 * one — which is what keeps this count level with the editor's, where such a
 * bullet renders without a checkbox widget. */
function collectTaskItems(node: Nodes, out: Array<{ item: ListItem; checked: boolean }>): void {
  if (node.type === "listItem" && node.checked != null) {
    out.push({ item: node, checked: node.checked });
  }
  if ("children" in node) {
    for (const child of node.children) collectTaskItems(child, out);
  }
}
