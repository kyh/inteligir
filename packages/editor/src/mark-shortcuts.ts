import { KEYS } from "platejs";

import type { EditorShortcut } from "@repo/editor/editor-shortcuts";

export type MarkShortcutAction = "toggle-bold" | "toggle-italic" | "toggle-underline";

export interface MarkShortcut extends EditorShortcut<MarkShortcutAction> {
  readonly mark: string;
}

export const MARK_SHORTCUTS: readonly MarkShortcut[] = [
  { action: "toggle-bold", hotkey: "mod+b", label: "Bold", mark: KEYS.bold },
  { action: "toggle-italic", hotkey: "mod+i", label: "Italic", mark: KEYS.italic },
  { action: "toggle-underline", hotkey: "mod+u", label: "Underline", mark: KEYS.underline },
];

export const markShortcut = (mark: string) =>
  MARK_SHORTCUTS.find((row) => row.mark === mark) ?? null;

export const markPluginShortcuts = (mark: string) => {
  const row = markShortcut(mark);

  if (row === null) {
    throw new Error(`MARK_SHORTCUTS has no row for the ${mark} mark`);
  }

  return { toggle: { keys: row.hotkey } };
};
