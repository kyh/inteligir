// Pinned to [0]: mdast-util-frontmatter emits the `---` fence wherever the node sits, and a
// mid-document fence re-parses as a thematic break.

import { ElementApi, createSlatePlugin } from "platejs";
import type { TNode } from "platejs";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

const FRONTMATTER_KEY = "frontmatter";

// the note's properties, edited through the properties panel: never a block a gesture takes.
export const isFrontmatterElement = (node: TNode | undefined): boolean =>
  ElementApi.isElement(node) && node.type === FRONTMATTER_KEY;

const FrontmatterBasePlugin = createSlatePlugin({
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

// Zero-height rather than unmounted: Slate needs the node's DOM point.
const FrontmatterElement = (props: PlateElementProps) => (
  <PlateElement {...props} className="h-0 overflow-hidden select-none">
    {props.children}
  </PlateElement>
);

export const FrontmatterKit = [FrontmatterBasePlugin.withComponent(FrontmatterElement)];
