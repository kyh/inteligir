import { useState } from "react";
import { useEditorRef, useElement, useReadOnly } from "platejs/react";

import { lockHolds } from "@repo/editor/nodes/rich-block-lock";

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
