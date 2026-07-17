// isEditorNotePrivate — the live document-derived read gating ghost-text and
// the ⌘J session. Fail-closed on the AI side: unreadable frontmatter is
// private. Strict otherwise: only a boolean `private: true` counts.

import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";

import { isEditorNotePrivate } from "@renderer/editor/note-privacy";
import { EDITOR_KIT } from "@renderer/editor/kits/editor-kit";
import { parseMarkdown } from "@renderer/editor/markdown/markdown-doc";

function seedEditor(md: string) {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error("fixture must parse");
  return createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
}

describe("isEditorNotePrivate", () => {
  it("no frontmatter → false", () => {
    expect(isEditorNotePrivate(seedEditor("# Hello\n\nbody\n"))).toBe(false);
  });

  it("private: true → true", () => {
    expect(isEditorNotePrivate(seedEditor("---\nprivate: true\n---\n\n# T\n"))).toBe(true);
  });

  it("private: false and string forms → false", () => {
    expect(isEditorNotePrivate(seedEditor("---\nprivate: false\n---\n\nx\n"))).toBe(false);
    expect(isEditorNotePrivate(seedEditor('---\nprivate: "true"\n---\n\nx\n'))).toBe(false);
    expect(isEditorNotePrivate(seedEditor("---\nprivate: yes\n---\n\nx\n"))).toBe(false);
  });

  it("unreadable frontmatter → true (fail-closed for AI surfaces)", () => {
    expect(isEditorNotePrivate(seedEditor("---\nprivate: false\nprivate: true\n---\n\nx\n"))).toBe(
      true,
    );
  });
});
