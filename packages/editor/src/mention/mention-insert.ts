import { getMentionOnSelectItem } from "@platejs/mention";
import type { SlateEditor } from "platejs";

import { toast } from "@repo/ui/components/sonner";

import { consumeTriggerLead } from "@repo/editor/combobox-input";
import { getEditorHostActions } from "@repo/editor/host-io";
import type { LinkTarget } from "@repo/editor/host-io";

// Plate's own pick: the mention lands at the caret, and the caret moves past it
const selectMention = getMentionOnSelectItem();

// a page link names the item by its id, with the title it goes by now, so no rename breaks it
const linkTo = (editor: SlateEditor, target: LinkTarget): void => {
  selectMention(editor, { key: target.id, text: target.title });
};

// the first `[` of the `[[` the picker opened on goes, and the link stands where it was
export const insertPageLink = (editor: SlateEditor, target: LinkTarget): void => {
  consumeTriggerLead(editor, "[");
  linkTo(editor, target);
};

// a link's Create: an empty note under the name, made where the item the editor shows is; null
// when it was not made
const createLinkedNote = async (title: string): Promise<string | null> => {
  try {
    return await getEditorHostActions().items.createNote({ blocks: [], title });
  } catch {
    toast.error(`Couldn't make the note ${title}.`);
    return null;
  }
};

// the note made first, since a page link names an item by its id; one not made leaves the words
// typed, as text
export const createAndLink = async (editor: SlateEditor, title: string): Promise<void> => {
  consumeTriggerLead(editor, "[");
  const at = editor.selection === null ? null : editor.api.pointRef(editor.selection.anchor);
  const itemId = await createLinkedNote(title);
  const point = at?.unref() ?? null;
  if (point === null) {
    return;
  }
  editor.tf.select(point);
  if (itemId === null) {
    editor.tf.insertText(`[[${title}]]`);
    return;
  }
  linkTo(editor, { id: itemId, title });
};
