import { describe, expect, it } from "vitest";
import { createPlateEditor } from "platejs/react";
import { KEYS, type Value } from "platejs";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { insertMarkdownAtSelection } from "@repo/editor/insert-markdown";
import { roundTrip } from "@repo/editor/markdown/markdown-doc";
import { expandTemplate } from "@repo/notes/templates/placeholders";

const EMPTY: Value = [{ children: [{ text: "" }], type: "p" }];

describe("inserting markdown at the selection", () => {
  it("lands the parsed blocks where the caret is", () => {
    const editor = createPlateEditor({ plugins: EDITOR_KIT, value: EMPTY });
    editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 0, path: [0, 0] } });
    expect(insertMarkdownAtSelection(editor, "## Agenda\n\n- one\n")).toBe(true);
    expect(editor.children[0]?.type).toBe(editor.getType(KEYS.h2));
    expect(editor.api.string([])).toContain("one");
  });
});

describe("a template through the editor", () => {
  it("round-trips byte-exact once its three placeholders are expanded, pills untouched", () => {
    const template =
      "# {{title}}\n\nOn {{date}} at {{time}}: {{2+2|4|id=total}} and {{date|day}}.\n";
    const expanded = expandTemplate(template, {
      now: new Date(2026, 8, 5, 9, 7),
      title: "Standup",
    });
    expect(expanded).toBe(
      "# Standup\n\nOn 2026-09-05 at 09:07: {{2+2|4|id=total}} and {{date|day}}.\n",
    );
    expect(roundTrip(expanded)).toBe(expanded);
  });
});
