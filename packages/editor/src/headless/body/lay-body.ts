import type { SlateEditor } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";

import { applyBodyChanges } from "./body-change";
import { blockChanges, sectionChanges } from "./block-changes";
import { blocksOfValue } from "./note-blocks";
import { setSection } from "./note-section";
import { blockId } from "@repo/editor/headless/node-props";

const laying = new WeakSet<SlateEditor>();

export const laysBody = (editor: SlateEditor) => laying.has(editor);

export const layBody = (editor: SlateEditor, blocks: readonly BodyBlock[]) => {
  const held = blocksOfValue(editor.children);
  const changes = blockChanges(held, blocks);
  const sections = sectionChanges(held, blocks);

  if (changes.length === 0 && sections.size === 0) {
    return true;
  }

  let landed = false;
  laying.add(editor);

  try {
    editor.tf.withoutSaving(() => {
      landed = applyBodyChanges(editor, changes).kind === "applied";

      if (!landed) {
        return;
      }

      for (const [id, section] of sections) {
        const at = editor.children.findIndex((node) => blockId(node) === id);

        if (at !== -1) {
          setSection(editor, [at], section);
        }
      }
    });
  } finally {
    laying.delete(editor);
  }

  return landed;
};
