// A node's edit popover is open only while the note takes edits: one open as the note stops
// closes for good, and a press then opens none to appear once it takes them again.

import { useState } from "react";
import { useReadOnly } from "platejs/react";

export const useEditPopover = () => {
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  if (open && readOnly) {
    setOpen(false);
  }
  return {
    open,
    setOpen: (next: boolean) => {
      setOpen(next && !readOnly);
    },
  };
};
