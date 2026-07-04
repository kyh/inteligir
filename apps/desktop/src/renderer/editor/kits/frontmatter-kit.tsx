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

function FrontmatterElement(props: PlateElementProps) {
  const value = typeof props.element.value === "string" ? props.element.value : "";
  return (
    <PlateElement {...props} className="mb-4">
      <div
        contentEditable={false}
        className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground select-text"
        title="Frontmatter is read-only in Rich mode — edit it in Raw"
      >
        <div className="mb-1 opacity-50 select-none">---</div>
        <pre className="whitespace-pre-wrap">{value}</pre>
        <div className="mt-1 opacity-50 select-none">---</div>
      </div>
      {props.children}
    </PlateElement>
  );
}

export const FrontmatterKit = [FrontmatterBasePlugin.withComponent(FrontmatterElement)];
