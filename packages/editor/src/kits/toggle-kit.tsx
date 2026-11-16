// Nested block children, not Plate's flat indent-sibling model: the headless BaseTogglePlugin is
// mounted for its openIds store, which the chevron hooks read, and never TogglePlugin, whose hider,
// index and Enter assume flat siblings. Open state lives in that store, never on the node, so
// collapsing cannot dirty the document.

import { ElementApi, KEYS, PathApi, createBlockStartInputRule } from "platejs";
import type { Path } from "platejs";
import { toPlatePlugin } from "platejs/react";
import type { PlateEditor } from "platejs/react";
import { BaseTogglePlugin } from "@platejs/toggle";

import { stringProp } from "@repo/editor/node-props";
import { ToggleElement } from "@repo/editor/nodes/toggle-node";

import { ToggleBodyPlugin } from "./headless/toggle-base";

export const wrapBlockInToggle = (editor: PlateEditor, at: Path): void => {
  editor.tf.withoutNormalizing(() => {
    const entry = editor.api.node(at);
    if (!entry || !ElementApi.isElement(entry[0]) || entry[0].type === KEYS.toggle) {
      return;
    }
    // the summary would carry list props into the toggle, where no marker spells them.
    editor.tf.unsetNodes(["listStyleType", "listStart", "indent", "checked"], { at });
    editor.tf.wrapNodes({ children: [], type: KEYS.toggle }, { at });
  });
  const toggle = editor.api.node(at);
  const id = toggle ? stringProp(toggle[0], "id") : undefined;
  if (id !== undefined && id !== "") {
    editor.getApi(BaseTogglePlugin).toggle.toggleIds([id], true);
  }
};

export const insertToggle = (editor: PlateEditor): void => {
  const block = editor.api.block();
  if (!block) {
    return;
  }
  wrapBlockInToggle(editor, block[1]);
};

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
        // A toggle is the lowest block only while it has no body, where Slate's split would make
        // it two toggles.
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
