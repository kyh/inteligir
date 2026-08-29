// The keyboard batch: ⌘E inline code, ⌘⇧C to-do item, ⌘L bulleted list,
// ⌘⇧L numbered list, ⌘T note title. Editor-local on purpose — the app's
// global shortcut table stays untouched — bound the way the comment kit binds
// ⌘⇧A. In a plain browser tab ⌘T (new tab) and sometimes ⌘L (address bar)
// are reserved before the page sees them; the Electron shell delivers both.

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

function inCodeBlock(editor: PlateEditor): boolean {
  return editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } });
}

/** Toggle the block against a list shape: already that shape → back to Text. */
function toggleList(editor: PlateEditor, id: TurnIntoId): void {
  const entry = effectiveBlockEntry(editor);
  const active = entry !== null && turnIntoOptionFor(entry[0]).id === id;
  turnIntoSelection(editor, turnIntoOption(active ? "text" : id));
}

/** The batch's one routing, exported so the test can call it directly (the
 * DOM dispatch belongs to Plate's editable, not to this table). */
export function handleEditorShortcut(editor: PlateEditor, event: ShortcutKeyEvent): void {
  if (isHotkey("mod+t", event)) {
    // The pressed editor names its own pane, so a split hands ⌘T to the title
    // above the document the user is typing in.
    if (focusNoteTitle(liveEditorPath(editor))) event.preventDefault();
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
