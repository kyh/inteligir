// A range runs from the point after its start marker to the point before its end
// marker. Pairing is per element: a pair that straddles blocks surfaces as two
// unpaired edges rather than a guessed span.

import { ElementApi, type Path, type Point, type SlateEditor, type TElement } from "platejs";

import { stringProp } from "@repo/editor/node-props";

export type CommentRange = {
  ids: string[];
  anchor: Point;
  focus: Point;
};

export type BlockCommentScan = {
  ranges: CommentRange[];
  unpairedIds: string[];
};

function markerIds(element: TElement): string[] {
  const raw = stringProp(element, "ids") ?? "";
  return raw.split(",").filter((id) => id !== "");
}

function markerEdge(element: TElement): "start" | "end" {
  return stringProp(element, "edge") === "end" ? "end" : "start";
}

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

export function holdsCommentMarkers(element: TElement): boolean {
  return element.children.some(
    (child) => ElementApi.isElement(child) && child.type === "commentMarker",
  );
}
