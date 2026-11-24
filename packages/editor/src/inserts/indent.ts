import type { SlateEditor } from "platejs";

export const indentBlocks = (editor: SlateEditor) => {
  editor.tf.tab({ reverse: false });
};

export const outdentBlocks = (editor: SlateEditor) => {
  editor.tf.tab({ reverse: true });
};
