// ---------------------------------------------------------------------------
// THE TASK ORDINAL — what `(sourceFile, ordinal)` names, and everything asked
// of it.
//
// A checkbox in a markdown file has no id, so every surface that points at one
// points at its POSITION among the file's GFM task items: document pre-order,
// counted over the canonical grammar (../markdown/scan-parse), checked items
// included. Delegation anchors on it, the Tasks view and the agent's
// `toggle_task` write through it, the projection persists it.
//
// So the COUNT lives here, once, and so does every question asked of it — which
// item an ordinal names, whether the caller may have that item, and how it is
// written back. One counter, and no surface may bring its own.
//
// TWO CALLERS, TWO STATE RULES, ONE COUNT. `openTaskAtOrdinal` refuses an item
// that is already checked, because handing a finished task to a background agent
// is work nobody asked for and the agent's first act would be to tick a box that
// is already ticked. `toggleTaskAtOrdinal` takes either state, because unticking
// a box is half of what toggling means. That difference is the FEATURE; the
// count underneath both is the same function, so the two can disagree about
// permission and never about which item.
// ---------------------------------------------------------------------------

import type { Heading, ListItem, Nodes } from "mdast";

import { parseWikiBodyRange } from "../markdown/remark-wiki-link";
import { parseScan } from "../markdown/scan-parse";
import { splitLines, toggleCheckboxLine, type CheckboxToggleResult } from "./source-lines";

/** One GFM task item (`- [ ]` checkbox), as the projection records it. `raw` is
 * the exact untrimmed source line EXCLUDING its terminator (./source-lines'
 * one rule) — which makes it the guarded write's own guard bytes. */
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
   * document order — the scheduling association input (never interpreted as
   * dates at extraction). */
  wikiTargets: string[];
};

/** Why an ordinal did not yield a task a caller may act on. Two values because
 * they are two different sentences to a person: one says the file moved under
 * them, the other says the work is already done. */
export type TaskLookupRefusal = "no-such-task" | "already-done";

/** An open (unchecked) task item, or the reason there isn't one. */
export type OpenTaskLookup =
  | { readonly ok: true; readonly task: ExtractedTask }
  | { readonly ok: false; readonly reason: TaskLookupRefusal };

/** Delegation's anchor, resolved against a file's current bytes. `text` and
 * `heading` are prompt context for the agent; the ordinal alone is the
 * identity. */
type TaskAnchor = {
  /** The full original line (e.g. "- [ ] book the flight"). */
  lineText: string;
  /** The item text (after `- [ ] `), for the agent prompt. */
  text: string;
  /** Nearest heading above the line, or null. */
  heading: string | null;
};

export type TaskAnchorLookup =
  | { readonly ok: true; readonly anchor: TaskAnchor }
  | { readonly ok: false; readonly reason: TaskLookupRefusal };

// The list marker + checkbox prefix on a task line; what's left is the item
// text.
const TASK_MARKER_RE = /^\s*[-*+]\s+\[[ xX]\]\s+/;

/** Every GFM task item in `source`, in ordinal order — the counting authority.
 * The `tasks: false` frontmatter opt-out is deliberately NOT applied: it hides
 * tasks from a VIEW, and an anchor must keep naming the same checkbox whatever
 * the note prefers. `scanDoc` applies the opt-out on top of this. */
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
    // slot instead would shift every task after it out from under its anchor.
    if (startLine === undefined) continue;
    const raw = lines[startLine - 1] ?? "";
    tasks.push({
      checked,
      text: raw.replace(TASK_MARKER_RE, "").trim(),
      raw,
      line: startLine,
      ordinal,
      wikiTargets: firstParagraphWikiTargets(item),
    });
  }
  return tasks;
}

/** The `ordinal`-th task item whatever its state, or null. THE lookup — every
 * caller below resolves through it, so no two of them can count differently. */
export function taskAtOrdinal(source: string, ordinal: number): ExtractedTask | null {
  // `.find`, not `[ordinal]`: an item the scan skipped consumed its slot there.
  return scanTaskItems(source).find((task) => task.ordinal === ordinal) ?? null;
}

/** The `ordinal`-th task item, refused when it is already checked — the rule
 * every DELEGATING surface reads (see this module's header for why it differs
 * from the toggle's). */
export function openTaskAtOrdinal(source: string, ordinal: number): OpenTaskLookup {
  const task = taskAtOrdinal(source, ordinal);
  if (task === null) return { ok: false, reason: "no-such-task" };
  if (task.checked) return { ok: false, reason: "already-done" };
  return { ok: true, task };
}

/**
 * Resolve delegation's `(sourceFile, ordinal)` anchor against a file's current
 * bytes: the open item at that ordinal, plus the heading standing over it.
 *
 * The heading is read off the SAME tree the ordinal was counted in, so the two
 * can never be answered under different grammars — and one parse serves both.
 */
export function resolveTaskAnchor(source: string, ordinal: number): TaskAnchorLookup {
  const tree = parseScan(source);
  const task = tasksInTree(tree, source).find((item) => item.ordinal === ordinal);
  if (task === undefined) return { ok: false, reason: "no-such-task" };
  if (task.checked) return { ok: false, reason: "already-done" };

  const lines = splitLines(source);
  const headings: HeadingInfo[] = [];
  collectHeadings(tree, headings, lines);
  return {
    ok: true,
    anchor: {
      lineText: task.raw,
      text: task.text,
      heading: nearestHeading(headings, task.line - 1),
    },
  };
}

/**
 * Toggle the `ordinal`-th task item after verifying its current source line
 * equals `expectedRaw`. Content-addressed: lines shifting above the item
 * relocate it by ordinal, while any edit to the line itself — or a different
 * task landing at the ordinal — refuses with `line-changed`.
 *
 * EITHER STATE IS ADDRESSABLE, which is the one thing this does not share with
 * `openTaskAtOrdinal` above.
 */
export function toggleTaskAtOrdinal(
  source: string,
  ordinal: number,
  expectedRaw: string,
): CheckboxToggleResult {
  const task = taskAtOrdinal(source, ordinal);
  if (task === null) return { ok: false, reason: "line-missing" };
  if (task.raw !== expectedRaw) return { ok: false, reason: "line-changed" };
  return toggleCheckboxLine(source, task.line - 1, expectedRaw);
}

// ---- counting ---------------------------------------------------------------

/** Pre-order DFS collecting task-list items (`checked` is a boolean) in
 * document order. A plain bullet in a mixed list has `checked: null` and is not
 * one — which is what keeps this count level with the editor's, where such a
 * bullet renders without a `checked` field. */
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

// ---- heading context --------------------------------------------------------

type HeadingInfo = { line: number; text: string };

/** Pre-order DFS collecting headings in document order, for the prompt
 * context. Headings inside fenced code aren't parsed as headings, so they can't
 * act as false boundaries. */
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
