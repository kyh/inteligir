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

function inCodeBlock(editor: PlateEditor): boolean {
  return editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } });
}

function toggleList(editor: PlateEditor, id: TurnIntoId): void {
  const entry = effectiveBlockEntry(editor);
  const active = entry !== null && turnIntoOptionFor(entry[0]).id === id;
  turnIntoSelection(editor, turnIntoOption(active ? "text" : id));
}

export function handleEditorShortcut(editor: PlateEditor, event: ShortcutKeyEvent): void {
  if (isHotkey("mod+t", event)) {
    if (focusNoteTitle(liveEditorPath(editor))) event.preventDefault();
    return;
  }
  if (isHotkey("mod+e", event)) {
    // a code mark inside a code block is nonsense the serializer would nest
    if (inCodeBlock(editor)) return;
    event.preventDefault();
    editor.tf.toggleMark(KEYS.code);
    return;
  }
  const id: TurnIntoId | null = isHotkey("mod+shift+c", event)
    ? "todo-list"
    : isHotkey("mod+shift+l", event)
      ? "numbered-list"
      : isHotkey("mod+l", event)
        ? "bulleted-list"
        : null;
  if (id === null) return;
  if (inCodeBlock(editor)) return;
  event.preventDefault();
  toggleList(editor, id);
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
