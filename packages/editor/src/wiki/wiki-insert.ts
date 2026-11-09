import { KEYS } from "platejs";
import type { SlateEditor, TElement } from "platejs";

import { toast } from "@repo/ui/components/sonner";

import { consumeTriggerLead } from "@repo/editor/combobox-input";
import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { getEditorHostActions } from "@repo/editor/host-io";
import type { LinkTarget } from "@repo/editor/host-io";

// a page link: the item by its id, with the title it goes by now, so no rename breaks it
export const pageLinkNode = (target: LinkTarget): TElement => ({
  children: [{ text: "" }],
  key: target.id,
  type: KEYS.mention,
  value: target.title,
});

// the `[[` the picker opened on goes, and the link stands where it was
export const insertPageLink = (editor: SlateEditor, target: LinkTarget): void => {
  consumeTriggerLead(editor, "[");
  // Slate would otherwise park the caret inside the void's empty text and swallow keystrokes.
  insertVoidAndEscape(editor, pageLinkNode(target));
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
  insertVoidAndEscape(editor, pageLinkNode({ id: itemId, title }));
};
