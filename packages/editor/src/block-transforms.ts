import { ElementApi, KEYS, NodeApi, PathApi } from "platejs";
import type { Path, TElement, TRange } from "platejs";
import type { PlateEditor } from "platejs/react";

import type { AlertVariant } from "@repo/contract/library/library-nodes";

import { wrapBlockInToggle } from "@repo/editor/inserts/toggle";
import { alertProp, stringProp } from "@repo/editor/headless/node-props";

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
  alert?: AlertVariant;
}

const TURN_INTO_ROWS = {
  "bulleted-list": {
    id: "bulleted-list",
    label: "Bulleted list",
    listStyleType: "disc",
    type: KEYS.p,
  },
  callout: { alert: "NOTE", id: "callout", label: "Callout", type: KEYS.blockquote },
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

export const turnIntoOption = (id: TurnIntoId) => TURN_INTO_ROWS[id];

const elementAt = (editor: PlateEditor, at: Path) => {
  const entry = editor.api.node(at);

  if (!entry || !ElementApi.isElement(entry[0])) {
    return null;
  }

  return entry[0];
};

const parentElement = (editor: PlateEditor, path: Path) => {
  if (path.length < 2) {
    return null;
  }

  const parentPath = PathApi.parent(path);
  const parent = elementAt(editor, parentPath);

  return (parent === null ? null : [parent, parentPath]) satisfies [TElement, Path] | null;
};

const turnIntoTarget = (editor: PlateEditor, entry: [TElement, Path]) => {
  const [node, path] = entry;

  const block =
    node.type === editor.getType(KEYS.codeLine) ? (parentElement(editor, path) ?? entry) : entry;

  const [, blockPath] = block;
  const parent = parentElement(editor, blockPath);

  if (parent === null) {
    return block;
  }

  const [container] = parent;

  const standsForParent =
    container.type === editor.getType(KEYS.blockquote) ||
    (container.type === editor.getType(KEYS.toggle) && blockPath.at(-1) === 0);

  return standsForParent ? parent : block;
};

export const effectiveBlockEntry = (editor: PlateEditor, at?: TRange) => {
  const block = editor.api.block(at ? { at } : {});

  if (!block || !ElementApi.isElement(block[0])) {
    return null;
  }

  return turnIntoTarget(editor, [block[0], block[1]]);
};

export const turnIntoOptionFor = (node: TElement) => {
  const listStyleType = stringProp(node, "listStyleType");

  if (listStyleType !== undefined) {
    return TURN_INTO.find((opt) => opt.listStyleType === listStyleType) ?? TURN_INTO_ROWS.text;
  }

  const isAlert = alertProp(node) !== undefined;

  const match = TURN_INTO.find(
    (opt) =>
      opt.listStyleType === undefined &&
      opt.type === node.type &&
      (opt.alert !== undefined) === isAlert,
  );

  return match ?? TURN_INTO_ROWS.text;
};

const quoteAt = (editor: PlateEditor, at: Path, alert: AlertVariant | undefined) => {
  const element = elementAt(editor, at);

  if (element === null) {
    return;
  }

  if (element.type !== editor.getType(KEYS.blockquote)) {
    editor.tf.setNodes({ type: editor.getType(KEYS.p) }, { at });
    editor.tf.wrapNodes({ children: [], type: editor.getType(KEYS.blockquote) }, { at });
  }

  if (alert !== undefined && alertProp(element) === undefined) {
    editor.tf.setNodes({ alert }, { at });
  }
};

const applyTarget = (editor: PlateEditor, at: Path, opt: TurnIntoOption) => {
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
      { at, select: true },
    );

    return;
  }

  if (opt.listStyleType !== undefined) {
    const props =
      opt.listStyleType === "todo"
        ? { checked: false, indent: 1, listStyleType: opt.listStyleType, type: KEYS.p }
        : { indent: 1, listStyleType: opt.listStyleType, type: KEYS.p };

    editor.tf.setNodes(props, { at });

    return;
  }

  editor.tf.unsetNodes(["listStyleType", "listStart", "indent", "checked"], { at });

  if (opt.type === KEYS.blockquote) {
    quoteAt(editor, at, opt.alert);

    return;
  }

  editor.tf.setNodes({ type: opt.type }, { at });
};

export const turnIntoAt = (editor: PlateEditor, at: Path, opt: TurnIntoOption) => {
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
    } else if (node.type === editor.getType(KEYS.blockquote) && opt.type !== KEYS.blockquote) {
      const index = at.at(-1);

      if (index === undefined) {
        return;
      }

      const count = node.children.length;
      editor.tf.unwrapNodes({ at });

      for (let i = count - 1; i >= 0; i -= 1) {
        turnIntoAt(editor, [...at.slice(0, -1), index + i], opt);
      }

      return;
    }

    if (opt.alert === undefined) {
      editor.tf.unsetNodes("alert", { at });
    }

    applyTarget(editor, at, opt);
  });
};

export const turnIntoBlocks = (editor: PlateEditor, paths: Path[], opt: TurnIntoOption) => {
  editor.tf.withoutNormalizing(() => {
    for (const path of paths.toSorted(PathApi.compare).toReversed()) {
      turnIntoAt(editor, path, opt);
    }
  });
};

export const turnIntoSelection = (editor: PlateEditor, opt: TurnIntoOption, at?: TRange) => {
  const entries = editor.api.blocks(at ? { at, mode: "lowest" } : { mode: "lowest" });
  const targets = new Map<string, Path>();

  for (const [node, path] of entries) {
    if (ElementApi.isElement(node)) {
      const [, target] = turnIntoTarget(editor, [node, path]);
      targets.set(target.join("."), target);
    }
  }

  turnIntoBlocks(editor, [...targets.values()], opt);
};

export const moveBlocks = (editor: PlateEditor, paths: Path[], direction: "up" | "down") => {
  const sorted = paths.toSorted(PathApi.compare);
  const [first] = sorted;
  const last = sorted.at(-1);
  const firstIndex = first?.at(-1);
  const lastIndex = last?.at(-1);

  if (!first || !last || firstIndex === undefined || lastIndex === undefined) {
    return;
  }

  const parent = PathApi.parent(first);

  const isRun = sorted.every(
    (path, i) => PathApi.equals(PathApi.parent(path), parent) && path.at(-1) === firstIndex + i,
  );

  if (!isRun) {
    return;
  }

  if (direction === "up") {
    if (firstIndex === 0) {
      return;
    }

    const prev = [...first.slice(0, -1), firstIndex - 1];
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
