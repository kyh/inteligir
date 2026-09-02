// Nested block children, not Plate's flat indent-sibling model: TogglePlugin is kept for its
// openIds store and chevron hooks, and its flat-model hider is inert here. Open state lives in
// that store, never on the node, so collapsing cannot dirty the document.

import { ElementApi, KEYS, PathApi, TextApi, createBlockStartInputRule, type Path } from "platejs";
import type { PlateEditor } from "platejs/react";
import { BaseTogglePlugin } from "@platejs/toggle";
import { TogglePlugin } from "@platejs/toggle/react";

import { stringProp } from "@repo/editor/node-props";
import { ToggleElement } from "@repo/editor/nodes/toggle-node";

export const ToggleBaseKit = [BaseTogglePlugin];

export function wrapBlockInToggle(editor: PlateEditor, at: Path): void {
  editor.tf.withoutNormalizing(() => {
    const entry = editor.api.node(at);
    if (!entry || !ElementApi.isElement(entry[0]) || entry[0].type === KEYS.toggle) return;
    // list props on the summary would serialize inside `<toggle>`.
    editor.tf.unsetNodes(["listStyleType", "listStart", "indent", "checked"], { at });
    editor.tf.wrapNodes({ children: [], type: KEYS.toggle }, { at });
  });
  const toggle = editor.api.node(at);
  const id = toggle ? stringProp(toggle[0], "id") : undefined;
  if (id) editor.getApi(TogglePlugin).toggle.toggleIds([id], true);
}

export function insertToggle(editor: PlateEditor): void {
  const block = editor.api.block();
  if (!block) return;
  wrapBlockInToggle(editor, block[1]);
}

const toggleInputRule = createBlockStartInputRule({
  match: "+",
  trigger: " ",
  enabled: ({ editor }) => !editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } }),
  apply: ({ editor }, match) => {
    editor.tf.delete({ at: match.range });
    insertToggle(editor);
    return true;
  },
});

export const ToggleKit = [
  TogglePlugin.configure({ inputRules: [toggleInputRule] })
    .withComponent(ToggleElement)
    .overrideEditor(({ editor, tf: { insertBreak, normalizeNode } }) => ({
      transforms: {
        // the plugin's flat-model insertBreak would indent-attach the new block at top level,
        // a shape that does not survive serialization.
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
        // typing into a parsed `<toggle />` gives it inline children; wrap them into a paragraph.
        // The headless gate never normalizes, so a bare `<toggle />` on disk stays byte-exact until edited.
        normalizeNode(entry) {
          const [node, path] = entry;
          if (
            ElementApi.isElement(node) &&
            node.type === KEYS.toggle &&
            node.children.some((child) => TextApi.isText(child) || editor.api.isInline(child)) &&
            node.children.some((child) => (TextApi.isText(child) ? child.text !== "" : true))
          ) {
            editor.tf.wrapNodes(
              { children: [], type: editor.getType(KEYS.p) },
              { at: path, children: true },
            );
            return;
          }
          normalizeNode(entry);
        },
      },
    })),
];
