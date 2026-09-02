// A checkbox has no id, so it is addressed by its position among the doc's task
// items; the editor counts off ../markdown/parse, and the two agree only while
// both disable `codeIndented` and `htmlFlow`.

import type { ListItem, Nodes } from "mdast";

import { parseScan } from "../markdown/scan-parse";
import { splitLines } from "./source-lines";

export type ExtractedTask = {
  checked: boolean;
  text: string;
  /** 1-based */
  line: number;
};

// bullets, ordered markers (`1.` / `2)`) and `> ` prefixes all carry live checkboxes in the
// editor; a narrower grammar would leave half a marker in the text of an accepted line
const CHECKBOX_MARKER_RE = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\](?=\s)/;

// a line the grammar refuses keeps its full text rather than a half-stripped one
function taskTextOf(raw: string): string {
  const marker = CHECKBOX_MARKER_RE.exec(raw);
  return (marker === null ? raw : raw.slice(marker[0].length)).trim();
}

// the `tasks: false` opt-out is not applied here: it hides tasks from a view, while the
// editor renders every checkbox regardless, so the count the two are compared on must ignore it
export function scanTaskItems(source: string): ExtractedTask[] {
  return tasksInTree(parseScan(source), source);
}

export function tasksInTree(tree: Nodes, source: string): ExtractedTask[] {
  const items: Array<{ item: ListItem; checked: boolean }> = [];
  collectTaskItems(tree, items);
  if (items.length === 0) return [];
  const lines = splitLines(source);
  const tasks: ExtractedTask[] = [];
  for (const { item, checked } of items) {
    const startLine = item.position?.start.line;
    // a synthetic tree names no line to read the text from
    if (startLine === undefined) continue;
    tasks.push({ checked, text: taskTextOf(lines[startLine - 1] ?? ""), line: startLine });
  }
  return tasks;
}

// a plain bullet in a mixed list has `checked: null` and renders no checkbox in the editor
function collectTaskItems(node: Nodes, out: Array<{ item: ListItem; checked: boolean }>): void {
  if (node.type === "listItem" && node.checked != null) {
    out.push({ item: node, checked: node.checked });
  }
  if ("children" in node) {
    for (const child of node.children) collectTaskItems(child, out);
  }
}
