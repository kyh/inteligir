// One pane's half of the comment tint. Mounted inside each pane's provider so
// the store learns a note's sidecar from the pane SHOWING it — a split's
// background pane would otherwise render its ranges against the focused note's
// ids and call every one of them an orphan.

import { openDocPath } from "@repo/editor/note/open-doc";
import { useOpenNote } from "@repo/editor/note/open-note-context";

import { usePaneCommentMeta } from "./comment-hooks";

export function PaneCommentMeta() {
  const path = useOpenNote((s) => openDocPath(s.openDoc));
  usePaneCommentMeta(path);
  return null;
}
