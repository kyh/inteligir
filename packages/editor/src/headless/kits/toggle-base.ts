import { ElementApi, KEYS, TextApi, createSlatePlugin } from "platejs";
import { BaseTogglePlugin } from "@platejs/toggle";

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
