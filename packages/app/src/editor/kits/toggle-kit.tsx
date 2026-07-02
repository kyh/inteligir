// Toggle kit. Node shape (WP1 serialization contract): `<toggle>` MDX flow
// element with NESTED block children — the first child is the summary row,
// the rest the collapsible body. This deliberately differs from Plate's flat
// indent-sibling toggle model: TogglePlugin is kept for its openIds store +
// chevron hooks, while hiding is done by ToggleElement on the nested children
// (the plugin's flat-model aboveNodes hider is inert here — nested children
// never enter its top-level toggle index). Collapsed/open state lives in that
// store, never on the node, so a collapse/expand can't dirty the document
// (md rule fixture asserts `<toggle>` serializes with zero attributes).

import { ElementApi, KEYS, PathApi, TextApi, createBlockStartInputRule, type Path } from "platejs";
import type { PlateEditor } from "platejs/react";
import { BaseTogglePlugin } from "@platejs/toggle";
import { TogglePlugin } from "@platejs/toggle/react";

import { ToggleElement } from "@repo/app/editor/nodes/toggle-node";

export const ToggleBaseKit = [BaseTogglePlugin];

/**
 * Wrap the block at `at` into a toggle: the block becomes the toggle's summary
 * (first nested child). The new toggle is opened so a body typed next is
 * immediately visible. Shared by insertToggle (slash) and turn-into (menus).
 */
export function wrapBlockInToggle(editor: PlateEditor, at: Path): void {
  editor.tf.withoutNormalizing(() => {
    const entry = editor.api.node(at);
    if (!entry || !ElementApi.isElement(entry[0]) || entry[0].type === KEYS.toggle) return;
    // List props on the summary would serialize inside `<toggle>` — strip.
    editor.tf.unsetNodes(["listStyleType", "listStart", "indent", "checked"], { at });
    editor.tf.wrapNodes({ children: [], type: KEYS.toggle }, { at });
  });
  const toggle = editor.api.node(at);
  const id = toggle && typeof toggle[0].id === "string" ? toggle[0].id : null;
  if (id) editor.getApi(TogglePlugin).toggle.toggleIds([id], true);
}

/** Turn the current block into a toggle. */
export function insertToggle(editor: PlateEditor): void {
  const block = editor.api.block();
  if (!block) return;
  wrapBlockInToggle(editor, block[1]);
}

// `+ ` at block start turns the block into a toggle (potion muscle memory).
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
        // Enter while the lowest block IS the toggle itself (an empty
        // `<toggle />` parses with inline text children) exits below instead
        // of splitting into two toggles — the plugin's flat-model insertBreak
        // would otherwise indent-attach the new block at top level, a shape
        // that doesn't survive serialization.
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
        // Typing into a parsed `<toggle />` gives the toggle non-empty inline
        // children; wrap them into a paragraph so the nested model (and its
        // canonical `<toggle>\n  text\n</toggle>` byte-form) is restored.
        // Live-editor-only: the headless gate never normalizes, so a bare
        // `<toggle />` on disk stays byte-exact until the user edits it.
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
