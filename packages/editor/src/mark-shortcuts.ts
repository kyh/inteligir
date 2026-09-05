// The chords Plate's mark plugins toggle on. The marks kit BUILDS each plugin's `shortcuts`
// config from these rows, so this table is what runs, not a description of it; the toolbar's
// tooltips and the palette's shortcuts page read the same rows. Inline code is not here: its
// chord is EDITOR_SHORTCUTS' `toggle-code-mark`, which also refuses inside a code block.

import { KEYS } from "platejs";

import type { EditorShortcut } from "@repo/editor/editor-shortcuts";

export type MarkShortcutAction = "toggle-bold" | "toggle-italic" | "toggle-underline";

export interface MarkShortcut extends EditorShortcut<MarkShortcutAction> {
  // the Plate mark key the chord toggles
  readonly mark: string;
}

export const MARK_SHORTCUTS: readonly MarkShortcut[] = [
  { hotkey: "mod+b", action: "toggle-bold", label: "Bold", mark: KEYS.bold },
  { hotkey: "mod+i", action: "toggle-italic", label: "Italic", mark: KEYS.italic },
  { hotkey: "mod+u", action: "toggle-underline", label: "Underline", mark: KEYS.underline },
];

export function markShortcut(mark: string): MarkShortcut | null {
  return MARK_SHORTCUTS.find((row) => row.mark === mark) ?? null;
}

// the plugin config for a mark's chord: Plate's `toggle` shortcut, keyed by the same string.
// A mark the kit wires through here without a row is a wiring error, not a mark without a chord.
export function markPluginShortcuts(mark: string) {
  const row = markShortcut(mark);
  if (row === null) throw new Error(`MARK_SHORTCUTS has no row for the ${mark} mark`);
  return { toggle: { keys: row.hotkey } };
}
