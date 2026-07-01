// "Turn into" block-type conversions, shared by the block handle menu
// (block-draggable) and the selection toolbar. Lists are indent-based (a
// paragraph carrying `listStyleType` + `indent`), so they share `type: KEYS.p`.

import { KEYS, type Path, type TRange } from "platejs";
import type { PlateEditor } from "platejs/react";

export type TurnIntoOption = { label: string; type: string; listStyleType?: string };

export const TURN_INTO: TurnIntoOption[] = [
  { label: "Text", type: KEYS.p },
  { label: "Heading 1", type: KEYS.h1 },
  { label: "Heading 2", type: KEYS.h2 },
  { label: "Heading 3", type: KEYS.h3 },
  { label: "Bulleted list", type: KEYS.p, listStyleType: "disc" },
  { label: "Numbered list", type: KEYS.p, listStyleType: "decimal" },
  { label: "To-do list", type: KEYS.p, listStyleType: "todo" },
  { label: "Quote", type: KEYS.blockquote },
];

/** Convert the block at `at` to the given target. */
export function turnIntoAt(editor: PlateEditor, at: Path, opt: TurnIntoOption): void {
  editor.tf.withoutNormalizing(() => {
    if (opt.listStyleType) {
      editor.tf.setNodes({ type: opt.type, listStyleType: opt.listStyleType, indent: 1 }, { at });
    } else {
      editor.tf.unsetNodes(["listStyleType", "indent"], { at });
      editor.tf.setNodes({ type: opt.type }, { at });
    }
  });
}

/**
 * Convert every block intersecting `at` (a remembered range), or the current
 * selection if omitted. Taking an explicit range avoids depending on
 * editor.selection being restored after a popover stole focus.
 */
export function turnIntoSelection(editor: PlateEditor, opt: TurnIntoOption, at?: TRange): void {
  const entries = editor.api.blocks(at ? { at, mode: "lowest" } : { mode: "lowest" });
  editor.tf.withoutNormalizing(() => {
    for (const [, path] of entries) turnIntoAt(editor, path, opt);
  });
}
