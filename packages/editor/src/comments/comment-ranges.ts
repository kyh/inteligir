// A range runs from the point after its start marker to the point before its end
// marker. Pairing is per element: a pair that straddles blocks surfaces as two
// unpaired edges rather than a guessed span.

import { ElementApi } from "platejs";
import type { Path, Point, SlateEditor, TElement } from "platejs";

import { stringProp } from "@repo/editor/node-props";

export interface CommentRange {
  ids: string[];
  anchor: Point;
  focus: Point;
}

export interface BlockCommentScan {
  ranges: CommentRange[];
  unpairedIds: string[];
}

const markerIds = (element: TElement): string[] => {
  const raw = stringProp(element, "ids") ?? "";
  return raw.split(",").filter((id) => id !== "");
};

const markerEdge = (element: TElement): "start" | "end" =>
  stringProp(element, "edge") === "end" ? "end" : "start";

export const scanBlockComments = (
  editor: SlateEditor,
  entry: [TElement, Path],
): BlockCommentScan => {
  const [element, path] = entry;
  const open = new Map<string, { ids: string[]; after: Point }>();
  const ranges: CommentRange[] = [];
  const unpaired = new Set<string>();

  for (const [index, child] of element.children.entries()) {
    if (!ElementApi.isElement(child) || child.type !== "commentMarker") {
      continue;
    }
    const ids = markerIds(child);
    if (ids.length === 0) {
      continue;
    }
    const key = ids.join(",");
    const markerPath = [...path, index];
    if (markerEdge(child) === "start") {
      const after = editor.api.after(markerPath);
      if (after) {
        open.set(key, { after, ids });
      }
      continue;
    }
    const started = open.get(key);
    const before = editor.api.before(markerPath);
    if (started === undefined || before === undefined) {
      for (const id of ids) {
        unpaired.add(id);
      }
      continue;
    }
    open.delete(key);
    ranges.push({ anchor: started.after, focus: before, ids: started.ids });
  }

  for (const { ids } of open.values()) {
    for (const id of ids) {
      unpaired.add(id);
    }
  }
  return { ranges, unpairedIds: [...unpaired] };
};

export const holdsCommentMarkers = (element: TElement): boolean =>
  element.children.some((child) => ElementApi.isElement(child) && child.type === "commentMarker");
