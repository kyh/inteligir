// A body the library holds, laid over an editor showing an older one in place, so the caret, the
// scroll and every block nobody changed stay as they are: the blocks someone else saved, or a merge
// of them with what is typed here. It is the library's change, not the person's: it stays out of
// their undo, which rebases over it, and lands though the editor takes no edit of theirs now.

import type { SlateEditor } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";

import { applyBodyChanges } from "./body-change";
import { blockChanges, sectionChanges } from "./block-changes";
import { blocksOfValue } from "./note-blocks";
import { setSection } from "./note-section";
import { blockId } from "@repo/editor/headless/node-props";

const laying = new WeakSet<SlateEditor>();

// whether the editor is taking a body the library holds, which no guard over its edits refuses
export const laysBody = (editor: SlateEditor): boolean => laying.has(editor);

// false when the blocks could not be laid in place, and the editor holds what it held
export const layBody = (editor: SlateEditor, blocks: readonly BodyBlock[]): boolean => {
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
