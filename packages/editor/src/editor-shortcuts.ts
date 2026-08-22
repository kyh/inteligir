// The Moss keyboard batch: ⌘E inline code, ⌘⇧C to-do item, ⌘L bulleted list,
// ⌘⇧L numbered list, ⌘T note title. Editor-local on purpose — the app's
// global shortcut table stays untouched — bound the way the comment kit binds
// ⌘⇧A. In a plain browser tab ⌘T (new tab) and sometimes ⌘L (address bar)
// are reserved before the page sees them; the Electron shell delivers both.

import { isHotkey, KEYS } from "platejs";
import { createPlatePlugin, type PlateEditor } from "platejs/react";

import {
  TURN_INTO,
  effectiveBlockEntry,
  turnIntoLabelFor,
  turnIntoSelection,
  type TurnIntoOption,
} from "@repo/editor/block-transforms";
import { focusNoteTitle } from "@repo/editor/note-title-focus";

/** What the routing reads off a keydown — structural, so the headless test
 * can drive the handler without a DOM event. */
export type ShortcutKeyEvent = {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  keyCode: number;
  metaKey: boolean;
  shiftKey: boolean;
  /** is-hotkey matches on `which`, not `key`/`keyCode`. */
  which: number;
  preventDefault: () => void;
};

function turnIntoOption(label: string): TurnIntoOption {
  const found = TURN_INTO.find((opt) => opt.label === label);
  if (found === undefined) throw new Error(`TURN_INTO lost its "${label}" row`);
  return found;
}

function inCodeBlock(editor: PlateEditor): boolean {
  return editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } });
}

/** Toggle the block against a list shape: already that shape → back to Text. */
function toggleList(editor: PlateEditor, label: string): void {
  const entry = effectiveBlockEntry(editor);
  const active = entry !== null && turnIntoLabelFor(entry[0]) === label;
  turnIntoSelection(editor, turnIntoOption(active ? "Text" : label));
}

/** The batch's one routing, exported so the test can call it directly (the
 * DOM dispatch belongs to Plate's editable, not to this table). */
export function handleEditorShortcut(editor: PlateEditor, event: ShortcutKeyEvent): void {
  if (isHotkey("mod+t", event)) {
    if (focusNoteTitle()) event.preventDefault();
    return;
  }
  if (isHotkey("mod+e", event)) {
    // Inside a code block the whole text is already code — a code MARK there
    // is nonsense the serializer would nest.
    if (inCodeBlock(editor)) return;
    event.preventDefault();
    editor.tf.toggleMark(KEYS.code);
    return;
  }
  const label = isHotkey("mod+shift+c", event)
    ? "To-do list"
    : isHotkey("mod+shift+l", event)
      ? "Numbered list"
      : isHotkey("mod+l", event)
        ? "Bulleted list"
        : null;
  if (label === null) return;
  if (inCodeBlock(editor)) return;
  event.preventDefault();
  toggleList(editor, label);
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
