// Marker mutations — every one an ordinary editor transaction, so the pair
// serializes through the dialect and one undo removes what one gesture added.

import { ElementApi, RangeApi, type SlateEditor, type TElement } from "platejs";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A fresh root id in the marker grammar's alphabet — 10 chars of the
 * lowercase set, collision-checked by the caller against known ids only in
 * the statistical sense (36^10 makes a clash a non-event). */
export function mintCommentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

function marker(id: string, edge: "start" | "end"): TElement {
  return { children: [{ text: "" }], edge, ids: id, type: "commentMarker" };
}

/**
 * Wrap the current selection with a start/end marker pair for `id`. End
 * first: inserting at the range's end leaves its start point untouched, so
 * the second insert lands exactly where the selection began. One
 * `withoutNormalizing` batch — one undo step.
 * Returns false (inserting nothing) on a collapsed selection.
 */
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

/**
 * Strip every marker naming any of `ids`. A multi-root marker
 * (`%%m:a,b:…%%`) keeps its other ids — the shared range survives the death
 * of one thread — and is removed only when the last id dies.
 */
export function removeCommentMarkers(editor: SlateEditor, ids: readonly string[]): void {
  const dead = new Set(ids);
  const entries = [
    ...editor.api.nodes<TElement>({
      at: [],
      match: (node) => ElementApi.isElement(node) && node.type === "commentMarker",
    }),
  ];
  editor.tf.withoutNormalizing(() => {
    // Reverse document order so earlier paths stay valid while later markers
    // are removed.
    for (const [node, path] of entries.toReversed()) {
      const raw = typeof node.ids === "string" ? node.ids : "";
      const kept = raw.split(",").filter((one) => one !== "" && !dead.has(one));
      if (kept.length === 0) {
        editor.tf.removeNodes({ at: path });
      } else if (kept.join(",") !== raw) {
        editor.tf.setNodes({ ids: kept.join(",") }, { at: path });
      }
    }
  });
}

/** The path of the FIRST marker naming `id`, or null. */
export function findCommentMarker(editor: SlateEditor, id: string) {
  for (const entry of editor.api.nodes<TElement>({
    at: [],
    match: (node) => ElementApi.isElement(node) && node.type === "commentMarker",
  })) {
    const raw = typeof entry[0].ids === "string" ? entry[0].ids : "";
    if (raw.split(",").includes(id)) return entry;
  }
  return null;
}
