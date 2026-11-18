import { isHotkey, KEYS } from "platejs";
import { SlateReactExtensionPlugin, createPlatePlugin } from "platejs/react";
import type { PlateEditor } from "platejs/react";

import {
  effectiveBlockEntry,
  turnIntoOption,
  turnIntoOptionFor,
  turnIntoSelection,
} from "@repo/editor/block-transforms";
import type { TurnIntoId } from "@repo/editor/block-transforms";

export interface ShortcutKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  keyCode: number;
  metaKey: boolean;
  shiftKey: boolean;
  /** is-hotkey matches on `which`. */
  which: number;
  preventDefault: () => void;
}

export type EditorShortcutAction =
  | "toggle-code-mark"
  | "toggle-todo-list"
  | "toggle-numbered-list"
  | "toggle-bulleted-list";

export interface EditorShortcut<Action extends string = EditorShortcutAction> {
  readonly hotkey: string;
  readonly action: Action;
  readonly label: string;
}

export const CODE_MARK_SHORTCUT: EditorShortcut<"toggle-code-mark"> = {
  action: "toggle-code-mark",
  hotkey: "mod+e",
  label: "Inline code",
};

const LIST_FOR_ACTION = {
  "toggle-bulleted-list": "bulleted-list",
  "toggle-numbered-list": "numbered-list",
  "toggle-todo-list": "todo-list",
} satisfies Partial<Record<EditorShortcutAction, TurnIntoId>>;

const listShortcut = (action: keyof typeof LIST_FOR_ACTION, hotkey: string) =>
  ({
    action,
    hotkey,
    label: turnIntoOption(LIST_FOR_ACTION[action]).label,
  }) satisfies EditorShortcut;

export const EDITOR_SHORTCUTS: readonly EditorShortcut[] = [
  CODE_MARK_SHORTCUT,
  listShortcut("toggle-todo-list", "mod+shift+c"),
  listShortcut("toggle-numbered-list", "mod+shift+l"),
  listShortcut("toggle-bulleted-list", "mod+l"),
];

export const matchesHotkey = (hotkey: string, event: ShortcutKeyEvent) =>
  // oxlint-disable-next-line typescript/no-unsafe-call -- platejs re-exports is-hotkey, which ships no types, so the type-aware pass reads the call as an unresolved type
  Boolean(isHotkey(hotkey, event));

export const editorShortcutFor = <Action extends string>(
  rows: readonly EditorShortcut<Action>[],
  event: ShortcutKeyEvent,
) => rows.find((row) => matchesHotkey(row.hotkey, event)) ?? null;

const inCodeBlock = (editor: PlateEditor) =>
  editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } });

const toggleList = (editor: PlateEditor, id: TurnIntoId) => {
  const entry = effectiveBlockEntry(editor);
  const active = entry !== null && turnIntoOptionFor(entry[0]).id === id;
  turnIntoSelection(editor, turnIntoOption(active ? "text" : id));
};

export const runEditorShortcut = (editor: PlateEditor, action: EditorShortcutAction) => {
  switch (action) {
    case "toggle-code-mark": {
      if (inCodeBlock(editor)) {
        return false;
      }

      editor.tf.toggleMark(KEYS.code);

      return true;
    }

    case "toggle-todo-list":
    case "toggle-numbered-list":
    case "toggle-bulleted-list": {
      if (inCodeBlock(editor)) {
        return false;
      }

      toggleList(editor, LIST_FOR_ACTION[action]);

      return true;
    }

    default: {
      throw new Error(`unexpected ${String(action satisfies never)}`);
    }
  }
};

export const handleEditorShortcut = (editor: PlateEditor, event: ShortcutKeyEvent) => {
  const row = editorShortcutFor(EDITOR_SHORTCUTS, event);

  if (row !== null && runEditorShortcut(editor, row.action)) {
    event.preventDefault();
  }
};

export const EditorShortcutsKit = [
  SlateReactExtensionPlugin.configure({ editOnly: true }),
  createPlatePlugin({ editOnly: true, key: "editorShortcuts" }).extend(() => ({
    handlers: {
      onKeyDown: ({ editor, event }) => {
        handleEditorShortcut(editor, event);
      },
    },
  })),
];
