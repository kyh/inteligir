import { KEYS, PathApi, createBlockStartInputRule } from "platejs";
import { toPlatePlugin } from "platejs/react";
import { BaseTogglePlugin } from "@platejs/toggle";

import { insertToggle } from "@repo/editor/inserts/toggle";
import { ToggleElement } from "@repo/editor/nodes/toggle-node";

import { ToggleBodyPlugin } from "@repo/editor/headless/kits/toggle-base";

const toggleInputRule = createBlockStartInputRule({
  apply: ({ editor }, match) => {
    editor.tf.delete({ at: match.range });
    insertToggle(editor);

    return true;
  },
  enabled: ({ editor }) => !editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } }),
  match: "+",
  trigger: " ",
});

export const ToggleKit = [
  toPlatePlugin(BaseTogglePlugin)
    .configure({ inputRules: [toggleInputRule] })
    .withComponent(ToggleElement)
    .overrideEditor(({ editor, tf: { insertBreak } }) => ({
      transforms: {
        insertBreak() {
          const block = editor.api.block();

          if (block && block[0].type === KEYS.toggle) {
            editor.tf.insertNodes(
              { children: [{ text: "" }], type: editor.getType(KEYS.p) },
              { at: PathApi.next(block[1]), select: true },
            );

            return;
          }

          insertBreak();
        },
      },
    })),
  ToggleBodyPlugin,
];
