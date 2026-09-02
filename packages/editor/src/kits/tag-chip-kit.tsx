// No TagChipBaseKit: a decoration never enters the value, and a base twin is the first step
// toward a tag node in the user's bytes. Suppression mirrors @repo/notes/knowledge/link-extract
// (tags only in mdast text nodes) — a chip the index does not know navigates to an empty list.

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
    if (!TextApi.isText(node) || !node.text.includes("#")) return undefined;
    // inline code is text to Slate but inlineCode to the index.
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
