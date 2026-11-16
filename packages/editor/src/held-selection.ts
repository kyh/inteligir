// What a menu or the link field acts on, held while it has focus. A ref rather than the range: a
// sync can rebase or re-seed the note under the open field, and a plain range would then land on
// whatever text took its place. Whoever holds one lets go of it with `unref`.

import { upsertLink } from "@platejs/link";
import type { RangeRef, SlateEditor } from "platejs";

import { toast } from "@repo/ui/components/sonner";

export const holdSelection = (editor: SlateEditor): RangeRef | null =>
  editor.selection === null ? null : editor.api.rangeRef(editor.selection, { affinity: "inward" });

export type LinkOutcome = "linked" | "moved";

// lets go of the held text; a link already over it takes the new address, since markdown cannot
// spell a link inside a link
export const applyLink = (editor: SlateEditor, held: RangeRef, url: string): LinkOutcome => {
  const range = held.unref();
  if (range === null) {
    toast.warning("The item changed — select the text again.");
    return "moved";
  }
  editor.tf.select(range);
  upsertLink(editor, { skipValidation: true, url });
  return "linked";
};
