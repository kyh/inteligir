import { getMentionOnSelectItem } from "@platejs/mention";
import type { SlateEditor } from "platejs";

import { toast } from "@repo/ui/components/sonner";

import { consumeTriggerLead } from "@repo/editor/headless/combobox-input";
import { getEditorHostActions } from "@repo/editor/host-io";
import type { LinkTarget } from "@repo/editor/host-io";

const selectMention = getMentionOnSelectItem();

const linkTo = (editor: SlateEditor, target: LinkTarget) => {
  selectMention(editor, { key: target.id, text: target.title });
};

export const insertPageLink = (editor: SlateEditor, target: LinkTarget) => {
  consumeTriggerLead(editor, "[");
  linkTo(editor, target);
};

const createLinkedNote = async (title: string) => {
  try {
    return await getEditorHostActions().items.createNote({ blocks: [], title });
  } catch {
    toast.error(`Couldn't make the note ${title}.`);

    return null;
  }
};

export const createAndLink = async (editor: SlateEditor, title: string) => {
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
