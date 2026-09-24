// Every mutation is an ordinary editor transaction, so one undo removes what one gesture added.

import { RangeApi } from "platejs";
import type { SlateEditor, TElement } from "platejs";

import { COMMENT_MARKER_KEY } from "@repo/editor/dialect-node-keys";
import { commentMarkerIds, isCommentMarker } from "./comment-ranges";

const marker = (id: string, edge: "start" | "end"): TElement => ({
  children: [{ text: "" }],
  edge,
  ids: id,
  type: COMMENT_MARKER_KEY,
});

// End first: inserting at the end leaves the start point untouched.
export const insertCommentMarkers = (editor: SlateEditor, id: string): boolean => {
  const { selection } = editor;
  if (!selection || RangeApi.isCollapsed(selection)) {
    return false;
  }
  const [start, end] = RangeApi.edges(selection);
  editor.tf.withoutNormalizing(() => {
    editor.tf.insertNodes(marker(id, "end"), { at: end });
    editor.tf.insertNodes(marker(id, "start"), { at: start });
  });
  return true;
};

// A multi-root marker keeps its other ids and is removed only when the last dies.
export const removeCommentMarkers = (editor: SlateEditor, ids: readonly string[]): void => {
  const dead = new Set(ids);
  const entries = [...editor.api.nodes<TElement>({ at: [], match: isCommentMarker })];
  editor.tf.withoutNormalizing(() => {
    // reverse order so earlier paths stay valid while later markers are removed
    for (const [node, path] of entries.toReversed()) {
      const held = commentMarkerIds(node);
      const kept = held.filter((one) => !dead.has(one));
      if (kept.length === 0) {
        editor.tf.removeNodes({ at: path });
      } else if (kept.length !== held.length) {
        editor.tf.setNodes({ ids: kept.join(",") }, { at: path });
      }
    }
  });
};

export const findCommentMarker = (editor: SlateEditor, id: string) => {
  for (const entry of editor.api.nodes<TElement>({ at: [], match: isCommentMarker })) {
    if (commentMarkerIds(entry[0]).includes(id)) {
      return entry;
    }
  }
  return null;
};
