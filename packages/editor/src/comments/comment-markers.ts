// Every mutation is an ordinary editor transaction, so one undo removes what one gesture added.

import { ElementApi, RangeApi, type SlateEditor, type TElement } from "platejs";

import { stringProp } from "@repo/editor/node-props";

function marker(id: string, edge: "start" | "end"): TElement {
  return { children: [{ text: "" }], edge, ids: id, type: "commentMarker" };
}

// End first: inserting at the end leaves the start point untouched.
export function insertCommentMarkers(editor: SlateEditor, id: string): boolean {
  const selection = editor.selection;
  if (!selection || RangeApi.isCollapsed(selection)) return false;
  const [start, end] = RangeApi.edges(selection);
  editor.tf.withoutNormalizing(() => {
    editor.tf.insertNodes(marker(id, "end"), { at: end });
    editor.tf.insertNodes(marker(id, "start"), { at: start });
  });
  return true;
}

// A multi-root marker keeps its other ids and is removed only when the last dies.
export function removeCommentMarkers(editor: SlateEditor, ids: readonly string[]): void {
  const dead = new Set(ids);
  const entries = [
    ...editor.api.nodes<TElement>({
      at: [],
      match: (node) => ElementApi.isElement(node) && node.type === "commentMarker",
    }),
  ];
  editor.tf.withoutNormalizing(() => {
    // reverse order so earlier paths stay valid while later markers are removed
    for (const [node, path] of entries.toReversed()) {
      const raw = stringProp(node, "ids") ?? "";
      const kept = raw.split(",").filter((one) => one !== "" && !dead.has(one));
      if (kept.length === 0) {
        editor.tf.removeNodes({ at: path });
      } else if (kept.join(",") !== raw) {
        editor.tf.setNodes({ ids: kept.join(",") }, { at: path });
      }
    }
  });
}

export function findCommentMarker(editor: SlateEditor, id: string) {
  for (const entry of editor.api.nodes<TElement>({
    at: [],
    match: (node) => ElementApi.isElement(node) && node.type === "commentMarker",
  })) {
    const raw = stringProp(entry[0], "ids") ?? "";
    if (raw.split(",").includes(id)) return entry;
  }
  return null;
}
