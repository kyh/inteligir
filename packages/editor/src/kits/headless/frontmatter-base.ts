// Pinned to [0]: mdast-util-frontmatter emits the `---` fence wherever the node sits, and a
// mid-document fence re-parses as a thematic break.

import { createSlatePlugin } from "platejs";

import { FRONTMATTER_KEY } from "@repo/editor/dialect-node-keys";
import { isFrontmatterElement } from "@repo/editor/properties/properties-node";

export const FrontmatterBasePlugin = createSlatePlugin({
  key: FRONTMATTER_KEY,
  node: { isElement: true, isVoid: true },
}).overrideEditor(({ editor, tf: { normalizeNode } }) => ({
  transforms: {
    normalizeNode(entry) {
      const [node, path] = entry;
      if (isFrontmatterElement(node) && (path.length !== 1 || path[0] !== 0)) {
        const [first] = editor.children;
        if (isFrontmatterElement(first)) {
          // a duplicate is removed, not moved: move-to-front for both would normalize-loop.
          editor.tf.removeNodes({ at: path });
        } else {
          editor.tf.moveNodes({ at: path, to: [0] });
        }
        return;
      }
      normalizeNode(entry);
    },
  },
}));

export const FrontmatterBaseKit = [FrontmatterBasePlugin];
