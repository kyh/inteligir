// Pinned to [0]: mdast-util-frontmatter emits the `---` fence wherever the node sits, and a
// mid-document fence re-parses as a thematic break.

import { ElementApi, createSlatePlugin } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";

const FrontmatterBasePlugin = createSlatePlugin({
  key: "frontmatter",
  node: { isElement: true, isVoid: true },
}).overrideEditor(({ editor, tf: { normalizeNode } }) => ({
  transforms: {
    normalizeNode(entry) {
      const [node, path] = entry;
      if (
        ElementApi.isElement(node) &&
        node.type === "frontmatter" &&
        (path.length !== 1 || path[0] !== 0)
      ) {
        const first = editor.children[0];
        if (ElementApi.isElement(first) && first.type === "frontmatter") {
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
function FrontmatterElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="h-0 overflow-hidden select-none">
      {props.children}
    </PlateElement>
  );
}

export const FrontmatterKit = [FrontmatterBasePlugin.withComponent(FrontmatterElement)];
