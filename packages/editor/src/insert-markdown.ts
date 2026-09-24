// the paste parser, not a second one: a template lands the bytes a paste would, fence-aware
// and dialect-aware, at the selection, and refuses what a paste would.

import type { SlateEditor } from "platejs";

import { mdToSlate } from "@repo/editor/markdown/md-to-slate";

export const insertMarkdownAtSelection = (editor: SlateEditor, markdown: string): boolean => {
  const converted = mdToSlate(editor, markdown);
  if (!converted.ok) {
    return false;
  }
  editor.tf.insertFragment(converted.nodes);
  return true;
};
