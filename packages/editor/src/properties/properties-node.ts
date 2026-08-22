// The one seam between the file-properties panel and the document: the panel
// edits the FRONTMATTER NODE, and Plate's normal serialize → onChange → editNote
// path persists it — there is no second write path to the file. These helpers
// read and write the frontmatter node's raw yaml `value` (see kits/frontmatter-
// kit.tsx: a void element pinned to path [0], serialized back byte-for-byte).
//
// Pure (no React): the panel calls them from event handlers, and the edit→
// serialize tests drive them headlessly against a createSlateEditor.

import { ElementApi, type SlateEditor, type TElement } from "platejs";

/** The frontmatter node's raw yaml (fences excluded, no trailing newline —
 * matching remark-frontmatter's node `value`), or `null` when the document has
 * no frontmatter block at all. `""` means an empty block (`---\n---`). */
export function readFrontmatterRaw(editor: SlateEditor): string | null {
  const first = editor.children[0];
  if (ElementApi.isElement(first) && first.type === "frontmatter") {
    return typeof first.value === "string" ? first.value : "";
  }
  return null;
}

/** Set the frontmatter block's raw yaml. Empty `raw` removes the block; when
 * none exists yet a node is inserted at [0] (the kit normalizer pins it there).
 * A single edit runs through Slate, so the editor's serialize path emits it. */
export function writeFrontmatterRaw(editor: SlateEditor, raw: string): void {
  const hasNode = readFrontmatterRaw(editor) !== null;
  if (raw === "") {
    if (hasNode) editor.tf.removeNodes({ at: [0] });
    return;
  }
  if (hasNode) {
    editor.tf.setNodes({ value: raw }, { at: [0] });
    return;
  }
  const node: TElement = { children: [{ text: "" }], type: "frontmatter", value: raw };
  editor.tf.insertNodes(node, { at: [0], select: false });
}
