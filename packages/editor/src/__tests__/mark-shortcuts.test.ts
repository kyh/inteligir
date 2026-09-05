// The kit's chords are the table's by construction; this pins, on a RESOLVED editor, that no
// plugin fell back to Plate's own default and that every row names a mark the kit registers.

import { KEYS } from "platejs";
import { createPlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EDITOR_SHORTCUTS } from "../editor-shortcuts";
import { BasicMarksKit } from "../kits/basic-marks-kit";
import { MARK_SHORTCUTS, markPluginShortcuts, markShortcut } from "../mark-shortcuts";

// the chord as Plate holds it after resolution: ours is a string, a default of Plate's is a key list
const toggleShortcutSchema = z.object({ keys: z.string() }).nullish();

function resolvedToggle(mark: string) {
  const editor = createPlateEditor({ plugins: BasicMarksKit });
  return toggleShortcutSchema.parse(editor.getPlugin({ key: mark }).shortcuts["toggle"]);
}

describe("the mark chords", () => {
  it("are what Plate runs, row for row", () => {
    for (const row of MARK_SHORTCUTS) {
      expect(resolvedToggle(row.mark)).toEqual({ keys: row.hotkey });
    }
  });

  it("name each mark once, and inline code stays with the editor's table", () => {
    const marks = MARK_SHORTCUTS.map((row) => row.mark);
    expect(new Set(marks).size).toBe(marks.length);
    expect(markShortcut(KEYS.code)).toBeNull();
    expect(() => markPluginShortcuts(KEYS.code)).toThrow(/no row/);
    expect(EDITOR_SHORTCUTS.some((row) => row.action === "toggle-code-mark")).toBe(true);
  });

  it("leave a mark with no chord unbound rather than on a Plate default", () => {
    expect(resolvedToggle(KEYS.strikethrough)).toBeUndefined();
  });
});
