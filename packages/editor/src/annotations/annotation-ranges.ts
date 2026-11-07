// Markers pair across the whole document in document order, so a range may span blocks: the
// dialect's block annotation is a marker on its own line above a fence and another below it. Only an
// edge with no partner is an orphan.

import { ElementApi, NodeApi, PathApi, PointApi } from "platejs";
import type { Path, SlateEditor, TElement, TNode, TRange, Value } from "platejs";

import { ANNOTATION_MARKER_KEY } from "@repo/editor/dialect-node-keys";
import { stringProp } from "@repo/editor/node-props";
import { splitMarkerIds } from "@repo/notes/markdown/remark-inline-constructs";

export interface AnnotationSpan {
  ids: string[];
  /** The top-level block holding the start marker, or the lone edge, however deep in it the
   * marker sits: a callout body or a table cell draws no gutter of its own. Compared by identity:
   * an overlay's path is the one its block last rendered with, which an insert above leaves
   * stale. */
  block: TElement;
  /** What the tint covers: between a pair, or the whole holder around a lone edge. Null when a
   * pair encloses nothing. */
  extent: TRange | null;
  orphan: boolean;
}

interface MarkerEdge {
  ids: string[];
  edge: "start" | "end";
  path: Path;
}

interface PlacedEdge extends MarkerEdge {
  block: TElement;
}

export const isAnnotationMarker = (node: TNode): node is TElement =>
  ElementApi.isElement(node) && node.type === ANNOTATION_MARKER_KEY;

export const annotationMarkerIds = (marker: TElement): string[] =>
  splitMarkerIds(stringProp(marker, "ids") ?? "");

// A keystroke replaces one top-level block and keeps every other one by identity, so only the
// block that changed is walked again. Paths are relative to the block, whose index can move.
const edgesByBlock = new WeakMap<TElement, readonly MarkerEdge[]>();

const blockEdges = (block: TElement): readonly MarkerEdge[] => {
  const cached = edgesByBlock.get(block);
  if (cached !== undefined) {
    return cached;
  }
  const edges: MarkerEdge[] = [];
  for (const [node, path] of NodeApi.descendants(block)) {
    if (!isAnnotationMarker(node)) {
      continue;
    }
    const ids = annotationMarkerIds(node);
    if (ids.length > 0) {
      const edge = stringProp(node, "edge") === "end" ? "end" : "start";
      edges.push({ edge, ids, path });
    }
  }
  edgesByBlock.set(block, edges);
  return edges;
};

export const blockHoldsAnnotationMarkers = (block: TElement): boolean =>
  blockEdges(block).length > 0;

const pairExtent = (editor: SlateEditor, start: Path, end: Path): TRange | null => {
  const anchor = editor.api.after(start);
  const focus = editor.api.before(end);
  return anchor !== undefined && focus !== undefined && PointApi.isBefore(anchor, focus)
    ? { anchor, focus }
    : null;
};

const holderExtent = (editor: SlateEditor, markerPath: Path): TRange | null => {
  const holderPath = PathApi.parent(markerPath);
  const anchor = editor.api.start(holderPath);
  const focus = editor.api.end(holderPath);
  return anchor !== undefined && focus !== undefined ? { anchor, focus } : null;
};

// An extent that stays inside one top-level block depends on that block alone, so it is kept by
// the block, its paths relative to it: a keystroke elsewhere moves at most the block's index, and
// asking Slate for a point before and after every pair on every change was a keystroke's walk.
const localExtents = new WeakMap<TElement, Map<string, TRange | null>>();

const relativeRange = ({ anchor, focus }: TRange): TRange => ({
  anchor: { offset: anchor.offset, path: anchor.path.slice(1) },
  focus: { offset: focus.offset, path: focus.path.slice(1) },
});

const placedRange = (index: number, { anchor, focus }: TRange): TRange => ({
  anchor: { offset: anchor.offset, path: [index, ...anchor.path] },
  focus: { offset: focus.offset, path: [index, ...focus.path] },
});

const extentInBlock = (
  block: TElement,
  index: number,
  key: string,
  measure: () => TRange | null,
): TRange | null => {
  let extents = localExtents.get(block);
  if (extents === undefined) {
    extents = new Map();
    localExtents.set(block, extents);
  }
  let relative = extents.get(key);
  if (relative === undefined) {
    const measured = measure();
    relative = measured === null ? null : relativeRange(measured);
    extents.set(key, relative);
  }
  return relative === null ? null : placedRange(index, relative);
};

const relativeKey = (path: Path): string => path.slice(1).join(".");

const pairEdges = (editor: SlateEditor): AnnotationSpan[] => {
  const open = new Map<string, PlacedEdge>();
  const spans: AnnotationSpan[] = [];
  // a lone edge tints its holder, which is inside its own block
  const lone = ({ block, ids, path }: PlacedEdge): void => {
    const extent = extentInBlock(block, path[0] ?? 0, `lone:${relativeKey(path)}`, () =>
      holderExtent(editor, path),
    );
    spans.push({ block, extent, ids, orphan: true });
  };
  const pairExtentOf = (started: PlacedEdge, edge: PlacedEdge): TRange | null =>
    started.block === edge.block
      ? extentInBlock(
          edge.block,
          edge.path[0] ?? 0,
          `pair:${relativeKey(started.path)}>${relativeKey(edge.path)}`,
          () => pairExtent(editor, started.path, edge.path),
        )
      : pairExtent(editor, started.path, edge.path);

  for (const [index, block] of editor.children.entries()) {
    for (const relative of blockEdges(block)) {
      const edge: PlacedEdge = { ...relative, block, path: [index, ...relative.path] };
      const key = edge.ids.join(",");
      const started = open.get(key);
      if (edge.edge === "start") {
        if (started !== undefined) {
          lone(started);
        }
        open.set(key, edge);
        continue;
      }
      if (started === undefined) {
        lone(edge);
        continue;
      }
      open.delete(key);
      spans.push({
        block: started.block,
        extent: pairExtentOf(started, edge),
        ids: started.ids,
        orphan: false,
      });
    }
  }

  for (const started of open.values()) {
    lone(started);
  }
  return spans;
};

const spansByDocument = new WeakMap<Value, readonly AnnotationSpan[]>();

// decorate asks on every render and each gutter on its block's, so a document is paired once
export const annotationSpans = (editor: SlateEditor): readonly AnnotationSpan[] => {
  const cached = spansByDocument.get(editor.children);
  if (cached !== undefined) {
    return cached;
  }
  const spans = pairEdges(editor);
  spansByDocument.set(editor.children, spans);
  return spans;
};

const idsByDocument = new WeakMap<Value, ReadonlyMap<TElement, readonly string[]>>();

// Every gutter asks for its own block on every change, so the spans are grouped once per document:
// filtering them once per gutter would make a keystroke quadratic in the note's annotations.
export const annotationIdsByBlock = (
  editor: SlateEditor,
): ReadonlyMap<TElement, readonly string[]> => {
  const cached = idsByDocument.get(editor.children);
  if (cached !== undefined) {
    return cached;
  }
  const grouped = new Map<TElement, Set<string>>();
  for (const { block, ids } of annotationSpans(editor)) {
    const held = grouped.get(block) ?? new Set<string>();
    for (const id of ids) {
      held.add(id);
    }
    grouped.set(block, held);
  }
  const byBlock = new Map([...grouped].map(([block, ids]) => [block, [...ids]]));
  idsByDocument.set(editor.children, byBlock);
  return byBlock;
};
