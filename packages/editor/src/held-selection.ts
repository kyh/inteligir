import { upsertLink } from "@platejs/link";
import type { RangeRef, SlateEditor } from "platejs";

import { toast } from "@repo/ui/components/sonner";

export const holdSelection = (editor: SlateEditor) =>
  editor.selection === null ? null : editor.api.rangeRef(editor.selection, { affinity: "inward" });

export const applyLink = (editor: SlateEditor, held: RangeRef, url: string) => {
  const range = held.unref();

  if (range === null) {
    toast.warning("The item changed — select the text again.");

    return "moved" as const;
  }

  editor.tf.select(range);
  upsertLink(editor, { skipValidation: true, url });

  return "linked" as const;
};
