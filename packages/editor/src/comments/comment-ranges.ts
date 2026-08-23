// Pairing the body's %%i:ids:start/end%% markers into decorated ranges, one
// block element at a time. Markers are inline-void nodes (the dialect's), so
// a range's anchor is the point AFTER its start marker and its focus the
// point BEFORE its end marker — the tint covers exactly the annotated text
// and never the plumbing. Pairing is per-element on purpose: the skill wraps
// an inline range inside one block, and a pair that straddles blocks (the
// block-marker form) surfaces as two unpaired edges rather than a guessed
// span. Multi-id markers (`%%i:a,b:start%%`) pair by their whole id set and
// tint once.

import { ElementApi, type Path, type Point, type SlateEditor, type TElement } from "platejs";

export type CommentRange = {
  ids: string[];
  anchor: Point;
  focus: Point;
};

export type BlockCommentScan = {
  ranges: CommentRange[];
  /** Ids on an edge whose partner never appears in this element — the
   * unterminated span the warning tint names. */
  unpairedIds: string[];
};

function markerIds(element: TElement): string[] {
  const raw = typeof element.ids === "string" ? element.ids : "";
  return raw.split(",").filter((id) => id !== "");
}

function markerEdge(element: TElement): "start" | "end" {
  return element.edge === "end" ? "end" : "start";
}

/** Scan ONE element's direct children for marker pairs. */
export function scanBlockComments(editor: SlateEditor, entry: [TElement, Path]): BlockCommentScan {
  const [element, path] = entry;
  const open = new Map<string, { ids: string[]; after: Point }>();
  const ranges: CommentRange[] = [];
  const unpaired = new Set<string>();

  element.children.forEach((child, index) => {
    if (!ElementApi.isElement(child) || child.type !== "commentMarker") return;
    const ids = markerIds(child);
    if (ids.length === 0) return;
    const key = ids.join(",");
    const markerPath = [...path, index];
    if (markerEdge(child) === "start") {
      const after = editor.api.after(markerPath);
      if (after) open.set(key, { after, ids });
      return;
    }
    const started = open.get(key);
    const before = editor.api.before(markerPath);
    if (started === undefined || before === undefined) {
      for (const id of ids) unpaired.add(id);
      return;
    }
    open.delete(key);
    ranges.push({ anchor: started.after, focus: before, ids: started.ids });
  });

  for (const { ids } of open.values()) {
    for (const id of ids) unpaired.add(id);
  }
  return { ranges, unpairedIds: [...unpaired] };
}

/** Whether an element directly holds any comment marker — the decorate fast
 * path. */
export function holdsCommentMarkers(element: TElement): boolean {
  return element.children.some(
    (child) => ElementApi.isElement(child) && child.type === "commentMarker",
  );
}
