// A checkbox has no id, so it is addressed by its position among the doc's task
// items; the editor counts off ../markdown/parse, and the two agree only while
// both disable `codeIndented` and `htmlFlow`.

import type { ListItem, Nodes } from "mdast";

import { parseScan } from "../markdown/scan-parse";
import { splitLines } from "./source-lines";

export interface ExtractedTask {
  checked: boolean;
  text: string;
  /** 1-based */
  line: number;
}

// bullets, ordered markers (`1.` / `2)`) and `> ` prefixes all carry live checkboxes in the
// editor; a narrower grammar would leave half a marker in the text of an accepted line
const CHECKBOX_MARKER_RE = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\](?=\s)/u;

// a line the grammar refuses keeps its full text rather than a half-stripped one
const taskTextOf = (raw: string): string => {
  const marker = CHECKBOX_MARKER_RE.exec(raw);
  return (marker === null ? raw : raw.slice(marker[0].length)).trim();
};

// a plain bullet in a mixed list has `checked: null` and renders no checkbox in the editor
const collectTaskItems = (node: Nodes, out: { item: ListItem; checked: boolean }[]): void => {
  if (node.type === "listItem" && node.checked !== null && node.checked !== undefined) {
    out.push({ checked: node.checked, item: node });
  }
  if ("children" in node) {
    for (const child of node.children) {
      collectTaskItems(child, out);
    }
  }
};

export const tasksInTree = (tree: Nodes, source: string): ExtractedTask[] => {
  const items: { item: ListItem; checked: boolean }[] = [];
  collectTaskItems(tree, items);
  if (items.length === 0) {
    return [];
  }
  const lines = splitLines(source);
  const tasks: ExtractedTask[] = [];
  for (const { item, checked } of items) {
    const startLine = item.position?.start.line;
    // a synthetic tree names no line to read the text from
    if (startLine === undefined) {
      continue;
    }
    tasks.push({ checked, line: startLine, text: taskTextOf(lines[startLine - 1] ?? "") });
  }
  return tasks;
};

// the `tasks: false` opt-out is not applied here: it hides tasks from a view, while the
// editor renders every checkbox regardless, so the count the two are compared on must ignore it
export const scanTaskItems = (source: string): ExtractedTask[] =>
  tasksInTree(parseScan(source), source);
