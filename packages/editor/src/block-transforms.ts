// Lists are indent-based paragraphs (`listStyleType` + `indent`); columns are not a turn-into target.

import { ElementApi, KEYS, NodeApi, PathApi } from "platejs";
import type { Path, TElement, TRange } from "platejs";
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

export interface TurnIntoOption {
  id: TurnIntoId;
  label: string;
  type: string;
  listStyleType?: string;
  marker?: string;
}

const TURN_INTO_ROWS = {
  "bulleted-list": {
    id: "bulleted-list",
    label: "Bulleted list",
    listStyleType: "disc",
    type: KEYS.p,
  },
  callout: { id: "callout", label: "Callout", marker: "[!NOTE] ", type: KEYS.blockquote },
  "code-block": { id: "code-block", label: "Code block", type: KEYS.codeBlock },
  "heading-1": { id: "heading-1", label: "Heading 1", type: KEYS.h1 },
  "heading-2": { id: "heading-2", label: "Heading 2", type: KEYS.h2 },
  "heading-3": { id: "heading-3", label: "Heading 3", type: KEYS.h3 },
  "numbered-list": {
    id: "numbered-list",
    label: "Numbered list",
    listStyleType: "decimal",
    type: KEYS.p,
  },
  quote: { id: "quote", label: "Quote", type: KEYS.blockquote },
  text: { id: "text", label: "Text", type: KEYS.p },
  "todo-list": { id: "todo-list", label: "To-do list", listStyleType: "todo", type: KEYS.p },
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

export const turnIntoOption = (id: TurnIntoId): TurnIntoOption => TURN_INTO_ROWS[id];

const ALERT_MARKER_RE = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s?/u;

const elementAt = (editor: PlateEditor, at: Path): TElement | null => {
  const entry = editor.api.node(at);
  if (!entry || !ElementApi.isElement(entry[0])) {
    return null;
  }
  return entry[0];
};

const retargetToggleSummary = (editor: PlateEditor, entry: [TElement, Path]): [TElement, Path] => {
  const [, path] = entry;
  if (path.length > 1 && path.at(-1) === 0) {
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
};

// A toggle's summary row (first child) stands for the toggle: "Toggle → Text" must unwrap it, not no-op on the inner paragraph.
export const effectiveBlockEntry = (editor: PlateEditor, at?: TRange): [TElement, Path] | null => {
  const block = editor.api.block(at ? { at } : {});
  if (!block || !ElementApi.isElement(block[0])) {
    return null;
  }
  return retargetToggleSummary(editor, [block[0], block[1]]);
};

export const turnIntoOptionFor = (node: TElement): TurnIntoOption => {
  const listStyleType = stringProp(node, "listStyleType");
  if (listStyleType !== undefined) {
    return TURN_INTO.find((opt) => opt.listStyleType === listStyleType) ?? TURN_INTO_ROWS.text;
  }
  const isAlert = node.type === KEYS.blockquote && ALERT_MARKER_RE.test(NodeApi.string(node));
  const match = TURN_INTO.find(
    (opt) =>
      opt.listStyleType === undefined && opt.type === node.type && Boolean(opt.marker) === isAlert,
  );
  return match ?? TURN_INTO_ROWS.text;
};

// Only when the first leaf carries the whole marker; one split across marks is left alone rather than half-deleted.
const stripAlertMarker = (editor: PlateEditor, at: Path): void => {
  const start = editor.api.start(at);
  if (!start) {
    return;
  }
  const leaf = editor.api.leaf(start);
  if (!leaf) {
    return;
  }
  const match = ALERT_MARKER_RE.exec(leaf[0].text);
  if (!match) {
    return;
  }
  editor.tf.delete({
    at: { anchor: start, focus: { offset: start.offset + match[0].length, path: start.path } },
  });
};

const applyTarget = (editor: PlateEditor, at: Path, opt: TurnIntoOption): void => {
  if (opt.type === KEYS.toggle) {
    wrapBlockInToggle(editor, at);
    return;
  }
  if (opt.type === KEYS.codeBlock) {
    const element = elementAt(editor, at);
    if (element === null) {
      return;
    }
    const text = NodeApi.string(element);
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
  if (opt.listStyleType !== undefined) {
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
  if (opt.marker !== undefined) {
    const element = elementAt(editor, at);
    const hasMarker = element !== null && ALERT_MARKER_RE.test(NodeApi.string(element));
    const start = editor.api.start(at);
    if (!hasMarker && start !== undefined) {
      editor.tf.insertText(opt.marker, { at: start });
    }
  }
};

export const turnIntoAt = (editor: PlateEditor, at: Path, opt: TurnIntoOption): void => {
  editor.tf.withoutNormalizing(() => {
    let node = elementAt(editor, at);
    if (node === null) {
      return;
    }

    if (node.type === editor.getType(KEYS.toggle)) {
      if (opt.type === KEYS.toggle) {
        return;
      }
      editor.tf.unwrapNodes({ at });
      const summary = elementAt(editor, at);
      if (summary === null) {
        return;
      }
      node = summary;
    } else if (node.type === editor.getType(KEYS.codeBlock)) {
      if (opt.type === KEYS.codeBlock) {
        return;
      }
      const index = at.at(-1);
      if (index === undefined) {
        return;
      }
      const lines = node.children.map((line) => NodeApi.string(line));
      editor.tf.removeNodes({ at });
      const texts = lines.length > 0 ? lines : [""];
      editor.tf.insertNodes(
        texts.map((text) => ({ children: [{ text }], type: editor.getType(KEYS.p) })),
        { at },
      );
      for (let i = texts.length - 1; i >= 0; i -= 1) {
        applyTarget(editor, [...at.slice(0, -1), index + i], opt);
      }
      return;
    }

    if (node.type === editor.getType(KEYS.blockquote) && opt.marker === undefined) {
      stripAlertMarker(editor, at);
    }

    applyTarget(editor, at, opt);
  });
};

// Takes an explicit range so it does not depend on editor.selection being restored after a popover stole focus.
export const turnIntoSelection = (editor: PlateEditor, opt: TurnIntoOption, at?: TRange): void => {
  const entries = editor.api.blocks(at ? { at, mode: "lowest" } : { mode: "lowest" });
  editor.tf.withoutNormalizing(() => {
    const seen = new Set<string>();
    for (const [node, path] of entries) {
      if (!ElementApi.isElement(node)) {
        continue;
      }
      const [, target] = retargetToggleSummary(editor, [node, path]);
      const key = target.join(".");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      turnIntoAt(editor, target, opt);
    }
  });
};

export const turnIntoBlocks = (editor: PlateEditor, paths: Path[], opt: TurnIntoOption): void => {
  editor.tf.withoutNormalizing(() => {
    for (const path of paths) {
      turnIntoAt(editor, path, opt);
    }
  });
};

export const moveBlocks = (editor: PlateEditor, paths: Path[], direction: "up" | "down"): void => {
  if (paths.length === 0) {
    return;
  }
  const sorted = paths.toSorted(PathApi.compare);
  const [first] = sorted;
  const last = sorted.at(-1);
  if (!first || !last) {
    return;
  }
  const firstIndex = first.at(-1);
  const lastIndex = last.at(-1);
  if (firstIndex === undefined || lastIndex === undefined) {
    return;
  }
  if (direction === "up") {
    if (firstIndex === 0) {
      return;
    }
    const prev = [...first.slice(0, -1), firstIndex - 1];
    // moveNodes' `to` is the post-removal index, so the previous sibling lands just below the group
    const to = [...last.slice(0, -1), lastIndex];
    editor.tf.moveNodes({ at: prev, to });
    return;
  }
  const next = [...last.slice(0, -1), lastIndex + 1];
  if (!editor.api.node(next)) {
    return;
  }
  editor.tf.moveNodes({ at: next, to: first });
};
