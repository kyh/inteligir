// In a plain browser tab ⌘T and sometimes ⌘L are reserved before the page sees
// them; the Electron shell delivers both.

import { isHotkey, KEYS } from "platejs";
import { createPlatePlugin } from "platejs/react";
import type { PlateEditor } from "platejs/react";

import {
  effectiveBlockEntry,
  turnIntoOption,
  turnIntoOptionFor,
  turnIntoSelection,
} from "@repo/editor/block-transforms";
import type { TurnIntoId } from "@repo/editor/block-transforms";
import { liveEditorPath } from "@repo/editor/live-editor";
import { focusNoteTitle } from "@repo/editor/note-title-focus";

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
  | "focus-note-title"
  | "toggle-code-mark"
  | "toggle-todo-list"
  | "toggle-numbered-list"
  | "toggle-bulleted-list";

// `hotkey` is is-hotkey's spelling; the palette's shortcuts page spells it for the platform.
export interface EditorShortcut<Action extends string = EditorShortcutAction> {
  readonly hotkey: string;
  readonly action: Action;
  readonly label: string;
}

export const EDITOR_SHORTCUTS: readonly EditorShortcut[] = [
  { action: "focus-note-title", hotkey: "mod+t", label: "Edit the note title" },
  { action: "toggle-code-mark", hotkey: "mod+e", label: "Inline code" },
  { action: "toggle-todo-list", hotkey: "mod+shift+c", label: "To-do list" },
  { action: "toggle-numbered-list", hotkey: "mod+shift+l", label: "Numbered list" },
  { action: "toggle-bulleted-list", hotkey: "mod+l", label: "Bulleted list" },
];

export const matchesHotkey = (hotkey: string, event: ShortcutKeyEvent): boolean =>
  // oxlint-disable-next-line typescript/no-unsafe-call -- is-hotkey ships no types, so platejs re-exports isHotkey as an error-typed value
  Boolean(isHotkey(hotkey, event));

export const editorShortcutFor = <Action extends string>(
  rows: readonly EditorShortcut<Action>[],
  event: ShortcutKeyEvent,
): EditorShortcut<Action> | null => rows.find((row) => matchesHotkey(row.hotkey, event)) ?? null;

const inCodeBlock = (editor: PlateEditor): boolean =>
  editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } });

const toggleList = (editor: PlateEditor, id: TurnIntoId): void => {
  const entry = effectiveBlockEntry(editor);
  const active = entry !== null && turnIntoOptionFor(entry[0]).id === id;
  turnIntoSelection(editor, turnIntoOption(active ? "text" : id));
};

const LIST_FOR_ACTION = {
  "toggle-bulleted-list": "bulleted-list",
  "toggle-numbered-list": "numbered-list",
  "toggle-todo-list": "todo-list",
} satisfies Partial<Record<EditorShortcutAction, TurnIntoId>>;

export const handleEditorShortcut = (editor: PlateEditor, event: ShortcutKeyEvent): void => {
  const row = editorShortcutFor(EDITOR_SHORTCUTS, event);
  if (row === null) {
    return;
  }
  switch (row.action) {
    case "focus-note-title": {
      if (focusNoteTitle(liveEditorPath(editor))) {
        event.preventDefault();
      }
      return;
    }
    case "toggle-code-mark": {
      // a code mark inside a code block is nonsense the serializer would nest
      if (inCodeBlock(editor)) {
        return;
      }
      event.preventDefault();
      editor.tf.toggleMark(KEYS.code);
      return;
    }
    case "toggle-todo-list":
    case "toggle-numbered-list":
    case "toggle-bulleted-list": {
      if (inCodeBlock(editor)) {
        return;
      }
      event.preventDefault();
      toggleList(editor, LIST_FOR_ACTION[row.action]);
    }
    // an exhaustive switch: falling off the end is what makes tsc reject a new action
    // no default
  }
};

export const EditorShortcutsKit = [
  createPlatePlugin({ key: "editorShortcuts" }).extend(() => ({
    handlers: {
      onKeyDown: ({ editor, event }) => {
        handleEditorShortcut(editor, event);
      },
    },
  })),
];
