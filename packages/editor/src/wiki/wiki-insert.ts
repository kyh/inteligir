import type { SlateEditor } from "platejs";

import { toast } from "@repo/ui/components/sonner";

import { consumeTriggerLead } from "@repo/editor/combobox-input";
import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { WIKI_EMBED_KEY, WIKI_LINK_KEY } from "@repo/editor/dialect-node-keys";
import { getEditorHostActions } from "@repo/editor/host-io";
import { wikiFieldsOfBody, wikiNode } from "@repo/editor/wiki/wiki-node";

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
  insertVoidAndEscape(editor, wikiNode(type, wikiFieldsOfBody(body)));
};

// a link's Create: an empty note under the name the link is written with, which the link then
// reaches by that name, made where the item the editor shows is
export const createLinkedNote = async (title: string): Promise<void> => {
  try {
    await getEditorHostActions().items.createNote({ blocks: [], title });
  } catch {
    toast.error(`Couldn't make the note ${title}.`);
  }
};
