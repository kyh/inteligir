import { ElementApi, KEYS, TextApi, createSlatePlugin } from "platejs";
import { BaseTogglePlugin } from "@platejs/toggle";

// Typing into an empty parsed toggle gives it inline children, which this wraps into a paragraph.
// Every editor of a note holds it, the note's own headless one included, so no reader of the live
// document fixes what its writer left. The codec's editor never normalizes, so an empty toggle is
// written as it was read until edited.
export const ToggleBodyPlugin = createSlatePlugin({ key: "toggleBody" }).overrideEditor(
  ({ editor, tf: { normalizeNode } }) => ({
    transforms: {
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
  }),
);

export const ToggleBaseKit = [BaseTogglePlugin, ToggleBodyPlugin];
