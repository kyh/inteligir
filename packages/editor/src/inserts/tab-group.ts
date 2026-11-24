import { KEYS } from "platejs";
import type { SlateEditor } from "platejs";

import { TAB_GROUP_KEY, TAB_PANEL_KEY } from "@repo/editor/headless/dialect-node-keys";

export const insertTabGroup = (editor: SlateEditor) => {
  editor.tf.insertNodes({
    children: [
      {
        children: [{ children: [{ text: "" }], type: editor.getType(KEYS.p) }],
        label: "Tab 1",
        type: TAB_PANEL_KEY,
      },
      {
        children: [{ children: [{ text: "" }], type: editor.getType(KEYS.p) }],
        label: "Tab 2",
        type: TAB_PANEL_KEY,
      },
    ],
    type: TAB_GROUP_KEY,
  });
};
