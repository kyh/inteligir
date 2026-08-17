// ---------------------------------------------------------------------------
// THE TASK ORDINAL — the one count of a doc's GFM checkboxes.
//
// A checkbox in a markdown file has no id, so anything that points at one
// points at its POSITION among the file's task items: document pre-order,
// counted over the canonical grammar (../markdown/scan-parse), checked items
// included. The projection persists that ordinal.
//
// So the COUNT lives here, once, and no surface may bring its own. The editor
// draws its checkboxes off a DIFFERENT parser (lezer-markdown), which is why
// packages/editor's checkbox-toggle suite pins the two against each other from
// the editor's side — a disagreement there desyncs every later ordinal.
// ---------------------------------------------------------------------------

import type { ListItem, Nodes } from "mdast";

import { parseWikiBodyRange } from "../markdown/remark-wiki-link";
import { parseScan } from "../markdown/scan-parse";
import { checkboxMarkerAt, splitLines } from "./source-lines";

/** One GFM task item (`- [ ]` checkbox), as the projection records it. `raw` is
 * the exact untrimmed source line EXCLUDING its terminator (./source-lines'
 * one rule). */
export type ExtractedTask = {
  checked: boolean;
  /** The item text after the checkbox marker, trimmed (inline md verbatim). */
  text: string;
  /** The EXACT untrimmed source line, terminator excluded. */
  raw: string;
  /** 1-based source line the item starts on. */
  line: number;
  /** Position among the doc's GFM task items (0-based, document pre-order). */
  ordinal: number;
  /** Wiki link/embed targets written inside the item's FIRST paragraph, in
   * document order (never interpreted here). */
  wikiTargets: string[];
};

// The item text is what follows the checkbox marker; locating the marker goes
// through ./source-lines' one grammar, so the strip cannot drift from the
// editor's reading of the same line. A raw line the grammar refuses (an item
// shape only the parser accepts) keeps its full text rather than a
// half-stripped one.
function taskTextOf(raw: string): string {
  const marker = checkboxMarkerAt(raw);
  return (marker === null ? raw : raw.slice(marker.checkboxIndex + 2)).trim();
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
  for (const [ordinal, { item, checked }] of items.entries()) {
    const startLine = item.position?.start.line;
    // An item with no source position still CONSUMES its ordinal: dropping the
    // slot instead would shift every task after it out from under its ordinal.
    if (startLine === undefined) continue;
    const raw = lines[startLine - 1] ?? "";
    tasks.push({
      checked,
      text: taskTextOf(raw),
      raw,
      line: startLine,
      ordinal,
      wikiTargets: firstParagraphWikiTargets(item),
    });
  }
  return tasks;
}

// ---- counting ---------------------------------------------------------------

/** Pre-order DFS collecting task-list items (`checked` is a boolean) in
 * document order. A plain bullet in a mixed list has `checked: null` and is not
 * one — which is what keeps this count level with the editor's, where such a
 * bullet renders without a checkbox widget. */
function collectTaskItems(node: Nodes, out: Array<{ item: ListItem; checked: boolean }>): void {
  if (node.type === "listItem" && typeof node.checked === "boolean") {
    out.push({ item: node, checked: node.checked });
  }
  if ("children" in node) {
    for (const child of node.children) collectTaskItems(child, out);
  }
}

/** Wiki link/embed targets inside the item's first paragraph (the checkbox
 * line's own text), document order — nested sub-lists don't contribute. */
function firstParagraphWikiTargets(item: ListItem): string[] {
  const paragraph = item.children.find((child) => child.type === "paragraph");
  if (!paragraph) return [];
  const targets: string[] = [];
  walkWikiTargets(paragraph, targets);
  return targets;
}

function walkWikiTargets(node: Nodes, out: string[]): void {
  if (node.type === "wikiLink" || node.type === "wikiEmbed") {
    const target = parseWikiBodyRange(node.body).target;
    if (target !== "") out.push(target);
  }
  if ("children" in node) {
    for (const child of node.children) walkWikiTargets(child, out);
  }
}
