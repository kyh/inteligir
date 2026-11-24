import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";
import { HorizontalRulePlugin } from "@platejs/basic-nodes/react";

export const insertHorizontalRule = (editor: PlateEditor) => {
  editor.tf.insertNodes(
    { children: [{ text: "" }], type: HorizontalRulePlugin.key },
    { select: true },
  );
  editor.tf.insertNodes({ children: [{ text: "" }], type: editor.getType(KEYS.p) });
};
