// Lists are indent-based paragraphs (`listStyleType` + `indent`); columns are not a turn-into target.

import { ElementApi, KEYS, NodeApi, PathApi, type Path, type TElement, type TRange } from "platejs";
import type { PlateEditor } from "platejs/react";

import { wrapBlockInToggle } from "@repo/editor/kits/toggle-kit";
import { stringProp } from "@repo/editor/node-props";

// Callers name rows by id, never by label: a label lookup made renaming a menu entry a silent behaviour change.
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
  marker?: string;
};

const TURN_INTO_ROWS = {
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
} satisfies Record<TurnIntoId, TurnIntoOption>;

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

export function turnIntoOption(id: TurnIntoId): TurnIntoOption {
  return TURN_INTO_ROWS[id];
}

const ALERT_MARKER_RE = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s?/;

// A toggle's summary row (first child) stands for the toggle: "Toggle → Text" must unwrap it, not no-op on the inner paragraph.
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

export function turnIntoOptionFor(node: TElement): TurnIntoOption {
  const listStyleType = stringProp(node, "listStyleType");
  if (listStyleType !== undefined) {
    return TURN_INTO.find((opt) => opt.listStyleType === listStyleType) ?? TURN_INTO_ROWS.text;
  }
  const isAlert = node.type === KEYS.blockquote && ALERT_MARKER_RE.test(NodeApi.string(node));
  const match = TURN_INTO.find(
    (opt) => !opt.listStyleType && opt.type === node.type && Boolean(opt.marker) === isAlert,
  );
  return match ?? TURN_INTO_ROWS.text;
}

// Only when the first leaf carries the whole marker; one split across marks is left alone rather than half-deleted.
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

export function turnIntoAt(editor: PlateEditor, at: Path, opt: TurnIntoOption): void {
  editor.tf.withoutNormalizing(() => {
    const entry = editor.api.node(at);
    if (!entry || !ElementApi.isElement(entry[0])) return;
    let node = entry[0];

    if (node.type === editor.getType(KEYS.toggle)) {
      if (opt.type === KEYS.toggle) return;
      editor.tf.unwrapNodes({ at });
      const summary = editor.api.node(at);
      if (!summary || !ElementApi.isElement(summary[0])) return;
      node = summary[0];
    } else if (node.type === editor.getType(KEYS.codeBlock)) {
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
      // slash-mermaid seeds its graph through the selection right after converting
      { at, select: true },
    );
    return;
  }
  if (opt.listStyleType) {
    // without `checked` the serializer emits a plain bullet
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

// Takes an explicit range so it does not depend on editor.selection being restored after a popover stole focus.
export function turnIntoSelection(editor: PlateEditor, opt: TurnIntoOption, at?: TRange): void {
  const entries = editor.api.blocks(at ? { at, mode: "lowest" } : { mode: "lowest" });
  editor.tf.withoutNormalizing(() => {
    const seen = new Set<string>();
    for (const [node, path] of entries) {
      if (!ElementApi.isElement(node)) continue;
      const [, target] = retargetToggleSummary(editor, [node, path]);
      const key = target.join(".");
      if (seen.has(key)) continue;
      seen.add(key);
      turnIntoAt(editor, target, opt);
    }
  });
}

export function turnIntoBlocks(editor: PlateEditor, paths: Path[], opt: TurnIntoOption): void {
  editor.tf.withoutNormalizing(() => {
    for (const path of paths) turnIntoAt(editor, path, opt);
  });
}

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
    // moveNodes' `to` is the post-removal index, so the previous sibling lands just below the group
    const to = [...last.slice(0, -1), lastIndex];
    editor.tf.moveNodes({ at: prev, to });
    return;
  }
  const next = [...last.slice(0, -1), lastIndex + 1];
  if (!editor.api.node(next)) return;
  editor.tf.moveNodes({ at: next, to: first });
}
