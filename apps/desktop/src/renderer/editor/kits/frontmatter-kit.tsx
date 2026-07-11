// Frontmatter kit. A void element holding the raw yaml source (`value`),
// read-only in Rich for v1 (edit via Raw — locked decision); the React half
// renders the yaml dimmed behind a `---` frame. WP3's block selection and the
// block draggable must exclude it (position pin below).
//
// The normalizer pins the node to path [0]: mdast-util-frontmatter emits the
// `---` fence wherever the node sits, and a mid-document fence re-parses as a
// thematic break — the position pin is what keeps idempotency.

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
}));

export const FrontmatterBaseKit = [FrontmatterBasePlugin];

// The frontmatter's user-facing surface is the typed properties panel
// (editor/properties/), hosted in the header's "Page details" popover (Raw
// mode edits the block directly). The node itself stays in the value (it
// serializes the `---` block byte-for-byte) but renders invisibly —
// zero-height and non-interactive, so it keeps its DOM point for Slate while
// the caret and block chrome skip past it.
function FrontmatterElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="h-0 overflow-hidden select-none">
      {props.children}
    </PlateElement>
  );
}

export const FrontmatterKit = [FrontmatterBasePlugin.withComponent(FrontmatterElement)];
