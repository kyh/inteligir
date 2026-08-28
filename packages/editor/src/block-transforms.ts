// "Turn into" block-type conversions + block move operations, shared by the
// slash menu, the block menu (context/grip), and the selection toolbar — one
// source per decision #8: paragraph/H1-3/quote/callout([!NOTE] marker)/code/
// toggle/todo/bullet/numbered; columns are NOT a turn-into target. Lists are
// indent-based (a paragraph carrying `listStyleType` + `indent`).

import { ElementApi, KEYS, NodeApi, PathApi, type Path, type TElement, type TRange } from "platejs";
import type { PlateEditor } from "platejs/react";

import { wrapBlockInToggle } from "@repo/editor/kits/toggle-kit";

/** The menu's vocabulary. Every caller names a row by this id, never by its
 * display label — a label is what a person reads, and looking one up by string
 * made "rename the menu entry" a silent behaviour change three call sites
 * away. */
export type TurnIntoId =
  | "text"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bulleted-list"
  | "numbered-list"
  | "todo-list"
  | "quote"
  | "callout"
  | "code-block"
  | "toggle";

export type TurnIntoOption = {
  id: TurnIntoId;
  label: string;
  type: string;
  listStyleType?: string;
  /** GitHub-alert marker inserted at block start (the product's callout). */
  marker?: string;
};

/** Closed over the vocabulary: a new id must declare its row here. */
const TURN_INTO_ROWS: Record<TurnIntoId, TurnIntoOption> = {
  text: { id: "text", label: "Text", type: KEYS.p },
  "heading-1": { id: "heading-1", label: "Heading 1", type: KEYS.h1 },
  "heading-2": { id: "heading-2", label: "Heading 2", type: KEYS.h2 },
  "heading-3": { id: "heading-3", label: "Heading 3", type: KEYS.h3 },
  "bulleted-list": {
    id: "bulleted-list",
    label: "Bulleted list",
    type: KEYS.p,
    listStyleType: "disc",
  },
  "numbered-list": {
    id: "numbered-list",
    label: "Numbered list",
    type: KEYS.p,
    listStyleType: "decimal",
  },
  "todo-list": { id: "todo-list", label: "To-do list", type: KEYS.p, listStyleType: "todo" },
  quote: { id: "quote", label: "Quote", type: KEYS.blockquote },
  callout: { id: "callout", label: "Callout", type: KEYS.blockquote, marker: "[!NOTE] " },
  "code-block": { id: "code-block", label: "Code block", type: KEYS.codeBlock },
  toggle: { id: "toggle", label: "Toggle", type: KEYS.toggle },
};

/** Menu order — the rows' own record has none. */
const TURN_INTO_ORDER: readonly TurnIntoId[] = [
  "text",
  "heading-1",
  "heading-2",
  "heading-3",
  "bulleted-list",
  "numbered-list",
  "todo-list",
  "quote",
  "callout",
  "code-block",
  "toggle",
];

export const TURN_INTO: readonly TurnIntoOption[] = TURN_INTO_ORDER.map((id) => TURN_INTO_ROWS[id]);

/** The row an id names. Total — every id has a row, so no caller carries a
 *  "not found" branch. */
export function turnIntoOption(id: TurnIntoId): TurnIntoOption {
  return TURN_INTO_ROWS[id];
}

const ALERT_MARKER_RE = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s?/;

/**
 * The block a turn-into acts on for a selection sitting at `at`: normally the
 * lowest block, but a toggle's SUMMARY row (first nested child) stands for
 * the toggle itself — converting "Toggle → Text" from the toolbar must
 * unwrap the toggle, not no-op on the paragraph inside it.
 */
export function effectiveBlockEntry(editor: PlateEditor, at?: TRange): [TElement, Path] | null {
  const block = editor.api.block(at ? { at } : {});
  if (!block || !ElementApi.isElement(block[0])) return null;
  return retargetToggleSummary(editor, [block[0], block[1]]);
}

function retargetToggleSummary(editor: PlateEditor, entry: [TElement, Path]): [TElement, Path] {
  const [, path] = entry;
  if (path.length > 1 && path[path.length - 1] === 0) {
    const parent = editor.api.node(PathApi.parent(path));
    if (
      parent &&
      ElementApi.isElement(parent[0]) &&
      parent[0].type === editor.getType(KEYS.toggle)
    ) {
      return [parent[0], parent[1]];
    }
  }
  return entry;
}

/** The TURN_INTO row describing `node` — the toolbar's type indicator reads
 *  its label, the shortcut batch its id. */
export function turnIntoOptionFor(
  node: { type: string } & Record<string, unknown>,
): TurnIntoOption {
  if (typeof node.listStyleType === "string") {
    return TURN_INTO.find((opt) => opt.listStyleType === node.listStyleType) ?? TURN_INTO_ROWS.text;
  }
  const isAlert =
    node.type === KEYS.blockquote &&
    ElementApi.isElement(node) &&
    ALERT_MARKER_RE.test(NodeApi.string(node));
  const match = TURN_INTO.find(
    (opt) => !opt.listStyleType && opt.type === node.type && Boolean(opt.marker) === isAlert,
  );
  return match ?? TURN_INTO_ROWS.text;
}

// Strip a leading GitHub-alert marker (unless the target wants one). Only
// when the block's first leaf carries the whole marker — a marker split
// across marks is left alone rather than half-deleted.
function stripAlertMarker(editor: PlateEditor, at: Path): void {
  const start = editor.api.start(at);
  if (!start) return;
  const leaf = editor.api.leaf(start);
  if (!leaf) return;
  const match = ALERT_MARKER_RE.exec(leaf[0].text);
  if (!match) return;
  editor.tf.delete({
    at: { anchor: start, focus: { offset: start.offset + match[0].length, path: start.path } },
  });
}

/**
 * Convert the block at `at` to the given target. Structural sources unwrap
 * first (toggle promotes its children and converts the summary; a code block
 * becomes one paragraph per code line), then the target applies.
 */
export function turnIntoAt(editor: PlateEditor, at: Path, opt: TurnIntoOption): void {
  editor.tf.withoutNormalizing(() => {
    const entry = editor.api.node(at);
    if (!entry || !ElementApi.isElement(entry[0])) return;
    let node = entry[0];

    // Source: toggle → promote children; the summary (first child, now at
    // `at`) is what converts.
    if (node.type === editor.getType(KEYS.toggle)) {
      if (opt.type === KEYS.toggle) return;
      editor.tf.unwrapNodes({ at });
      const summary = editor.api.node(at);
      if (!summary || !ElementApi.isElement(summary[0])) return;
      node = summary[0];
    }
    // Source: code block → one paragraph per code line, then convert each.
    else if (node.type === editor.getType(KEYS.codeBlock)) {
      if (opt.type === KEYS.codeBlock) return;
      const index = at[at.length - 1];
      if (index === undefined) return;
      const lines = node.children.map((line) => NodeApi.string(line));
      editor.tf.removeNodes({ at });
      const texts = lines.length > 0 ? lines : [""];
      editor.tf.insertNodes(
        texts.map((text) => ({ children: [{ text }], type: editor.getType(KEYS.p) })),
        { at },
      );
      for (let i = texts.length - 1; i >= 0; i--) {
        applyTarget(editor, [...at.slice(0, -1), index + i], opt);
      }
      return;
    }

    // Source: alert blockquote → drop the marker unless the target is the
    // callout itself (its marker is re-ensured below).
    if (node.type === editor.getType(KEYS.blockquote)) {
      if (!opt.marker) stripAlertMarker(editor, at);
    }

    applyTarget(editor, at, opt);
  });
}

function applyTarget(editor: PlateEditor, at: Path, opt: TurnIntoOption): void {
  if (opt.type === KEYS.toggle) {
    wrapBlockInToggle(editor, at);
    return;
  }
  if (opt.type === KEYS.codeBlock) {
    const entry = editor.api.node(at);
    if (!entry || !ElementApi.isElement(entry[0])) return;
    const text = NodeApi.string(entry[0]);
    editor.tf.removeNodes({ at });
    editor.tf.insertNodes(
      {
        children: text
          .split("\n")
          .map((line) => ({ children: [{ text: line }], type: editor.getType(KEYS.codeLine) })),
        type: editor.getType(KEYS.codeBlock),
      },
      // select: the caret lands in the new code block (slash-mermaid seeds
      // its graph through the selection right after converting).
      { at, select: true },
    );
    return;
  }
  if (opt.listStyleType) {
    // Todo items need `checked` so the serializer emits `- [ ]` (without it
    // the item round-trips to a plain bullet).
    const props =
      opt.listStyleType === "todo"
        ? { checked: false, indent: 1, listStyleType: opt.listStyleType, type: KEYS.p }
        : { indent: 1, listStyleType: opt.listStyleType, type: KEYS.p };
    editor.tf.setNodes(props, { at });
    return;
  }
  editor.tf.unsetNodes(["listStyleType", "listStart", "indent", "checked"], { at });
  editor.tf.setNodes({ type: opt.type }, { at });
  if (opt.marker) {
    const entry = editor.api.node(at);
    const hasMarker =
      entry && ElementApi.isElement(entry[0]) && ALERT_MARKER_RE.test(NodeApi.string(entry[0]));
    const start = editor.api.start(at);
    if (!hasMarker && start) editor.tf.insertText(opt.marker, { at: start });
  }
}

/**
 * Convert every block intersecting `at` (a remembered range), or the current
 * selection if omitted. Taking an explicit range avoids depending on
 * editor.selection being restored after a popover stole focus.
 */
export function turnIntoSelection(editor: PlateEditor, opt: TurnIntoOption, at?: TRange): void {
  const entries = editor.api.blocks(at ? { at, mode: "lowest" } : { mode: "lowest" });
  editor.tf.withoutNormalizing(() => {
    const seen = new Set<string>();
    for (const [node, path] of entries) {
      if (!ElementApi.isElement(node)) continue;
      // A toggle's summary row stands for the toggle itself (dedupe so a
      // range spanning summary + body doesn't convert the toggle twice).
      const [, target] = retargetToggleSummary(editor, [node, path]);
      const key = target.join(".");
      if (seen.has(key)) continue;
      seen.add(key);
      turnIntoAt(editor, target, opt);
    }
  });
}

/** Convert the blocks at `paths` (block-menu path: acts on block selection). */
export function turnIntoBlocks(editor: PlateEditor, paths: Path[], opt: TurnIntoOption): void {
  editor.tf.withoutNormalizing(() => {
    for (const path of paths) turnIntoAt(editor, path, opt);
  });
}

/**
 * Move the span of blocks from the first to the last of `paths` one step
 * up/down among their siblings, implemented as a single move of the flanking
 * sibling across the group (no per-block path shifting). No-ops at the edges.
 */
export function moveBlocks(editor: PlateEditor, paths: Path[], direction: "up" | "down"): void {
  if (paths.length === 0) return;
  const sorted = paths.toSorted(PathApi.compare);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return;
  const firstIndex = first[first.length - 1];
  const lastIndex = last[last.length - 1];
  if (firstIndex === undefined || lastIndex === undefined) return;
  if (direction === "up") {
    if (firstIndex === 0) return;
    const prev = [...first.slice(0, -1), firstIndex - 1];
    // `to` is the node's FINAL index (post-removal): the previous sibling
    // lands where the group's last block was, i.e. directly below it.
    const to = [...last.slice(0, -1), lastIndex];
    editor.tf.moveNodes({ at: prev, to });
    return;
  }
  const next = [...last.slice(0, -1), lastIndex + 1];
  if (!editor.api.node(next)) return;
  editor.tf.moveNodes({ at: next, to: first });
}
