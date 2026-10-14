import type { SlateEditor } from "platejs";

import { consumeTriggerLead } from "@repo/editor/combobox-input";
import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { WIKI_EMBED_KEY, WIKI_LINK_KEY } from "@repo/editor/dialect-node-keys";

// A `!` before the `[[` upgrades the chip to an embed.
export const insertWikiChipFromPicker = (
  editor: SlateEditor,
  body: string,
  forceEmbed = false,
): void => {
  consumeTriggerLead(editor, "[");
  const bang = consumeTriggerLead(editor, "!");
  const type = forceEmbed || bang ? WIKI_EMBED_KEY : WIKI_LINK_KEY;
  // Slate would otherwise park the caret inside the void's empty text and swallow keystrokes.
  insertVoidAndEscape(editor, { body, children: [{ text: "" }], type });
};
