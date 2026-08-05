// Tag-chip kit: the render-only leaf decoration that turns inline `#tag` text
// into clickable chips (component + scanner in nodes/tag-chip-node.tsx).
//
// REACT HALF ONLY, by design — there is no TagChipBaseKit and there must never
// be one. Decorations never enter the document value, so the serializer mirror
// (BASE_KIT) has nothing to mirror; adding it there would be the first step
// toward a tag NODE, which would put chip state into the user's bytes. The
// calloutMarker decoration in basic-blocks-kit is the same shape.
//
// Suppression parity with the index: @repo/notes/knowledge/link-extract only
// counts tags in mdast `text` nodes, so code spans, code fences and link/image
// LABELS never produce a tag. The Slate equivalents are the inline `code` mark
// and the code-block / link ancestors, checked below — a chip over text that
// isn't in the index would navigate to an empty note list.

import {
  ElementApi,
  KEYS,
  NodeApi,
  TextApi,
  createSlatePlugin,
  type DecoratedRange,
  type SlateEditor,
} from "platejs";

import { inlineTagSpans } from "@repo/notes/knowledge/link-extract";

import { TagChipLeaf } from "@repo/editor/nodes/tag-chip-node";

/** Element types whose text the tag index never scans. */
function isSuppressedAncestor(editor: SlateEditor, type: string): boolean {
  return (
    type === editor.getType(KEYS.codeBlock) ||
    type === editor.getType(KEYS.codeLine) ||
    type === editor.getType(KEYS.link) ||
    type === "frontmatter"
  );
}

const TagChipPlugin = createSlatePlugin({
  key: "tagChip",
  node: { isLeaf: true },
  decorate: ({ editor, entry: [node, path] }) => {
    // Fast path first: `decorate` runs for every text run on every render, and
    // the overwhelming majority carry no `#` at all.
    if (!TextApi.isText(node) || !node.text.includes("#")) return undefined;
    // Inline code (`#tag` inside backticks) is text to Slate but an
    // `inlineCode` node to the index — not a tag.
    if (node[editor.getType(KEYS.code)] === true) return undefined;
    for (let depth = 1; depth < path.length; depth += 1) {
      const ancestor = NodeApi.get(editor, path.slice(0, depth));
      if (!ElementApi.isElement(ancestor)) continue;
      if (isSuppressedAncestor(editor, ancestor.type)) return undefined;
    }
    const ranges: DecoratedRange[] = [];
    for (const span of inlineTagSpans(node.text)) {
      const range: DecoratedRange & { tagChip: true } = {
        anchor: { offset: span.start, path },
        focus: { offset: span.end, path },
        tagChip: true,
      };
      ranges.push(range);
    }
    return ranges.length > 0 ? ranges : undefined;
  },
}).withComponent(TagChipLeaf);

export const TagChipKit = [TagChipPlugin];
