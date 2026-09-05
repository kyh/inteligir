// In a plain browser tab ⌘T and sometimes ⌘L are reserved before the page sees
// them; the Electron shell delivers both.

import { isHotkey, KEYS } from "platejs";
import { createPlatePlugin, type PlateEditor } from "platejs/react";

import {
  effectiveBlockEntry,
  turnIntoOption,
  turnIntoOptionFor,
  turnIntoSelection,
  type TurnIntoId,
} from "@repo/editor/block-transforms";
import { liveEditorPath } from "@repo/editor/live-editor";
import { focusNoteTitle } from "@repo/editor/note-title-focus";

export type ShortcutKeyEvent = {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  keyCode: number;
  metaKey: boolean;
  shiftKey: boolean;
  /** is-hotkey matches on `which`. */
  which: number;
  preventDefault: () => void;
};

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
  { hotkey: "mod+t", action: "focus-note-title", label: "Edit the note title" },
  { hotkey: "mod+e", action: "toggle-code-mark", label: "Inline code" },
  { hotkey: "mod+shift+c", action: "toggle-todo-list", label: "To-do list" },
  { hotkey: "mod+shift+l", action: "toggle-numbered-list", label: "Numbered list" },
  { hotkey: "mod+l", action: "toggle-bulleted-list", label: "Bulleted list" },
];

export function editorShortcutFor<Action extends string>(
  rows: readonly EditorShortcut<Action>[],
  event: ShortcutKeyEvent,
): EditorShortcut<Action> | null {
  return rows.find((row) => isHotkey(row.hotkey, event)) ?? null;
}

function inCodeBlock(editor: PlateEditor): boolean {
  return editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } });
}

function toggleList(editor: PlateEditor, id: TurnIntoId): void {
  const entry = effectiveBlockEntry(editor);
  const active = entry !== null && turnIntoOptionFor(entry[0]).id === id;
  turnIntoSelection(editor, turnIntoOption(active ? "text" : id));
}

const LIST_FOR_ACTION = {
  "toggle-todo-list": "todo-list",
  "toggle-numbered-list": "numbered-list",
  "toggle-bulleted-list": "bulleted-list",
} satisfies Partial<Record<EditorShortcutAction, TurnIntoId>>;

export function handleEditorShortcut(editor: PlateEditor, event: ShortcutKeyEvent): void {
  const row = editorShortcutFor(EDITOR_SHORTCUTS, event);
  if (row === null) return;
  switch (row.action) {
    case "focus-note-title":
      if (focusNoteTitle(liveEditorPath(editor))) event.preventDefault();
      return;
    case "toggle-code-mark":
      // a code mark inside a code block is nonsense the serializer would nest
      if (inCodeBlock(editor)) return;
      event.preventDefault();
      editor.tf.toggleMark(KEYS.code);
      return;
    case "toggle-todo-list":
    case "toggle-numbered-list":
    case "toggle-bulleted-list":
      if (inCodeBlock(editor)) return;
      event.preventDefault();
      toggleList(editor, LIST_FOR_ACTION[row.action]);
      return;
  }
}

export const EditorShortcutsKit = [
  createPlatePlugin({ key: "editorShortcuts" }).extend(() => ({
    handlers: {
      onKeyDown: ({ editor, event }) => {
        handleEditorShortcut(editor, event);
      },
    },
  })),
];
