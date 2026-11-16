// A node's edit popover is open only while the note takes edits: one open as the note stops
// closes for good, and a press then opens none to appear once it takes them again. Nor does a
// press open one on a node a touch surface's lock holds, whose edit the model would refuse alike.

import { useState } from "react";
import { useEditorRef, useElement, useReadOnly } from "platejs/react";

import { lockHolds } from "@repo/editor/kits/rich-block-lock-kit";

export const useEditPopover = () => {
  const editor = useEditorRef();
  const element = useElement();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  if (open && readOnly) {
    setOpen(false);
  }
  return {
    open,
    setOpen: (next: boolean) => {
      setOpen(next && !readOnly && !lockHolds(editor, element));
    },
  };
};
