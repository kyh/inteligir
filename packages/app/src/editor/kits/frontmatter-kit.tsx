// Frontmatter kit — Base half (WP1). A void element holding the raw yaml
// source (`value`), read-only in Rich for v1 (edit via Raw — locked decision).
// WP2 appends the renderer.
//
// The normalizer pins the node to path [0]: mdast-util-frontmatter emits the
// `---` fence wherever the node sits, and a mid-document fence re-parses as a
// thematic break — the position pin is what keeps idempotency. Block dragging
// and block selection must additionally exclude it (WP2/3 consume this
// constraint).

import { ElementApi, createSlatePlugin } from "platejs";

export const FrontmatterBaseKit = [
  createSlatePlugin({
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
            // A frontmatter block already sits at [0] — a document has exactly
            // one, so a stray duplicate (paste) is removed, not shuffled
            // (move-to-front for both would normalize-loop).
            editor.tf.removeNodes({ at: path });
          } else {
            editor.tf.moveNodes({ at: path, to: [0] });
          }
          return;
        }
        normalizeNode(entry);
      },
    },
  })),
];
