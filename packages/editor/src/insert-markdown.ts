// the paste parser, not a second one: a template lands the bytes a paste would, fence-aware
// and dialect-aware, at the selection.

import { getMergedOptionsDeserialize, mdastToSlate } from "@platejs/markdown";
import type { SlateEditor } from "platejs";

import { parseMdast } from "@repo/notes/markdown/parse";

export function insertMarkdownAtSelection(editor: SlateEditor, markdown: string): boolean {
  const parsed = parseMdast(markdown);
  if (!parsed.ok) return false;
  const nodes = mdastToSlate(parsed.root, getMergedOptionsDeserialize(editor));
  editor.tf.insertFragment(nodes);
  return true;
}
