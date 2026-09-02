import type { SlateEditor } from "platejs";

import { insertVoidAndEscape } from "@repo/editor/insert-void";

// after the picker's commit the caret sits after the first `[` of `[[` (withTriggerCombobox
// swallowed the second); consume it, and a preceding `!` upgrades the chip to an embed.
export function insertWikiChipFromPicker(
  editor: SlateEditor,
  body: string,
  forceEmbed = false,
): void {
  editor.tf.deleteBackward("character"); // the "[" the trigger left in the text
  let type = forceEmbed ? "wikiEmbed" : "wikiLink";
  const selection = editor.selection;
  if (selection && editor.api.isCollapsed()) {
    const before = editor.api.before(selection.anchor);
    if (before && editor.api.string({ anchor: before, focus: selection.anchor }) === "!") {
      editor.tf.deleteBackward("character");
      type = "wikiEmbed";
    }
  }
  // Slate would otherwise park the caret inside the void's empty text and swallow keystrokes.
  insertVoidAndEscape(editor, { body, children: [{ text: "" }], type });
}
