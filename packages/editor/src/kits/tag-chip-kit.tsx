import { ElementApi, KEYS, NodeApi, TextApi, createSlatePlugin } from "platejs";
import type { DecoratedRange, SlateEditor } from "platejs";

import { tagSpansIn } from "@repo/contract/library/derive-item";

import { TagChipLeaf } from "@repo/editor/nodes/tag-chip-node";

const isSuppressedAncestor = (editor: SlateEditor, type: string) =>
  type === editor.getType(KEYS.codeBlock) ||
  type === editor.getType(KEYS.codeLine) ||
  type === editor.getType(KEYS.link);

const TagChipPlugin = createSlatePlugin({
  decorate: ({ editor, entry: [node, path] }) => {
    if (!TextApi.isText(node) || !node.text.includes("#")) {
      return;
    }

    if (node[editor.getType(KEYS.code)] === true) {
      return;
    }

    for (let depth = 1; depth < path.length; depth += 1) {
      const ancestor = NodeApi.get(editor, path.slice(0, depth));

      if (!ElementApi.isElement(ancestor)) {
        continue;
      }

      if (isSuppressedAncestor(editor, ancestor.type)) {
        return;
      }
    }

    const ranges: DecoratedRange[] = [];

    for (const span of tagSpansIn(node.text)) {
      const range: DecoratedRange & { tagChip: true } = {
        anchor: { offset: span.start, path },
        focus: { offset: span.end, path },
        tagChip: true,
      };

      ranges.push(range);
    }

    return ranges.length > 0 ? ranges : undefined;
  },
  key: "tagChip",
  node: { isLeaf: true },
}).withComponent(TagChipLeaf);

export const TagChipKit = [TagChipPlugin];
