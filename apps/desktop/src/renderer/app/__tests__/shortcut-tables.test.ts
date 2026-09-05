import { EDITOR_SHORTCUTS } from "@repo/editor/editor-shortcuts";
import { FIND_BAR_SHORTCUTS } from "@repo/editor/find-bar";
import { MARK_SHORTCUTS } from "@repo/editor/mark-shortcuts";
import { describe, expect, it } from "vitest";
import { GLOBAL_SHORTCUTS, globalShortcutHotkey } from "../global-shortcuts";

const editorChords = [...MARK_SHORTCUTS, ...EDITOR_SHORTCUTS, ...FIND_BAR_SHORTCUTS].map(
  (row) => row.hotkey,
);
const globalChords = GLOBAL_SHORTCUTS.map(globalShortcutHotkey);

function duplicates(chords: readonly string[]): string[] {
  const seen = new Set<string>();
  return chords.filter((chord) => (seen.has(chord) ? true : (seen.add(chord), false)));
}

describe("the shortcut tables", () => {
  it("share no chord: the window listener and the editor's would both run it", () => {
    const shared = globalChords.filter((chord) => editorChords.includes(chord));
    expect(
      shared,
      "A chord in both GLOBAL_SHORTCUTS (global-shortcuts.ts) and the editor's tables (mark-shortcuts.ts, editor-shortcuts.ts, find-bar.tsx) fires twice. Give it one owner:",
    ).toEqual([]);
  });

  it("claim each chord once within a table", () => {
    expect(duplicates(globalChords)).toEqual([]);
    expect(duplicates(editorChords)).toEqual([]);
  });
});
