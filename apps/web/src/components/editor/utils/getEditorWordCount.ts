import type { SlateEditor } from "platejs";

const WHITESPACE_REGEX = /\s+/;

export function getEditorWordCount(editor: SlateEditor) {
  const text = editor.api.string([]);

  return text ? text.trim().split(WHITESPACE_REGEX).filter(Boolean).length : 0;
}
