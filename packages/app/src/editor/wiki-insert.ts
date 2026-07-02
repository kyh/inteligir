// The `[[` picker's editor-mutation core, React-free so the completion
// behavior (consume the literal "[" the trigger left behind, upgrade a
// preceding "!" into an embed) is pinned by headless regression tests —
// the same split as combobox-input.ts.

import type { SlateEditor } from "platejs";

import { insertVoidAndEscape } from "@repo/app/editor/insert-void";

/**
 * Insert a wiki chip after the picker's commit removed the trigger element.
 * At that point the caret sits right after the literal `[` that preceded the
 * trigger (the FIRST bracket of `[[` — withTriggerCombobox swallowed the
 * second). Consume it, and when a `!` precedes it (`![[`), consume that too
 * and insert a wikiEmbed instead of a wikiLink.
 */
export function insertWikiChipFromPicker(editor: SlateEditor, body: string): void {
  editor.tf.deleteBackward("character"); // the "[" the trigger left in the text
  let type = "wikiLink";
  const selection = editor.selection;
  if (selection && editor.api.isCollapsed()) {
    const before = editor.api.before(selection.anchor);
    if (before && editor.api.string({ anchor: before, focus: selection.anchor }) === "!") {
      editor.tf.deleteBackward("character");
      type = "wikiEmbed";
    }
  }
  // insertVoidAndEscape moves the caret past the chip — Slate would otherwise
  // park it inside the void's empty text and swallow subsequent keystrokes.
  insertVoidAndEscape(editor, { body, children: [{ text: "" }], type });
}
