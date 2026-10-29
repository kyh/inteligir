// Nested block children, not Plate's flat indent-sibling model: TogglePlugin is kept for its
// openIds store and chevron hooks, and its flat-model hider is switched off below. Open state
// lives in that store, never on the node, so collapsing cannot dirty the document.

import { ElementApi, KEYS, PathApi, TextApi, createBlockStartInputRule } from "platejs";
import type { Path } from "platejs";
import type { PlateEditor } from "platejs/react";
import { TogglePlugin } from "@platejs/toggle/react";

import { stringProp } from "@repo/editor/node-props";
import { ToggleElement } from "@repo/editor/nodes/toggle-node";

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
    editor.getApi(TogglePlugin).toggle.toggleIds([id], true);
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

// The flat model's hider and its index are off: a toggle's body is its own children, so no
// top-level block is enclosed by indent, and the hider was a store atom per block that every
// change recomputed beside a walk of the top level, most of a keystroke in a long note.
export const wrapNoBlock = (): undefined => {
  /* no block is hidden by a toggle above it */
};
export const indexNoToggles = (): void => {
  /* the toggle index stays empty, so no block reads as inside a closed toggle */
};

export const ToggleKit = [
  TogglePlugin.configure({ inputRules: [toggleInputRule] })
    .extend({ render: { aboveNodes: wrapNoBlock }, useHooks: indexNoToggles })
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
        // typing into an empty parsed toggle gives it inline children; wrap them into a paragraph.
        // The headless gate never normalizes, so an empty toggle on disk stays byte-exact until edited.
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
