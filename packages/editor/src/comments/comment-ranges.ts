// Markers pair across the whole document in document order, so a range may span blocks: the
// dialect's block comment is a marker on its own line above a fence and another below it. Only an
// edge with no partner is an orphan.

import { ElementApi, NodeApi, PathApi, PointApi } from "platejs";
import type { Path, SlateEditor, TElement, TNode, TRange, Value } from "platejs";

import { COMMENT_MARKER_KEY } from "@repo/editor/dialect-node-keys";
import { stringProp } from "@repo/editor/node-props";
import { splitMarkerIds } from "@repo/notes/markdown/remark-inline-constructs";

export interface CommentSpan {
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

export const isCommentMarker = (node: TNode): node is TElement =>
  ElementApi.isElement(node) && node.type === COMMENT_MARKER_KEY;

export const commentMarkerIds = (marker: TElement): string[] =>
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
    if (!isCommentMarker(node)) {
      continue;
    }
    const ids = commentMarkerIds(node);
    if (ids.length > 0) {
      const edge = stringProp(node, "edge") === "end" ? "end" : "start";
      edges.push({ edge, ids, path });
    }
  }
  edgesByBlock.set(block, edges);
  return edges;
};

export const blockHoldsCommentMarkers = (block: TElement): boolean => blockEdges(block).length > 0;

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

const pairEdges = (editor: SlateEditor): CommentSpan[] => {
  const open = new Map<string, PlacedEdge>();
  const spans: CommentSpan[] = [];
  const lone = ({ block, ids, path }: PlacedEdge): void => {
    spans.push({ block, extent: holderExtent(editor, path), ids, orphan: true });
  };

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
        extent: pairExtent(editor, started.path, edge.path),
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

const spansByDocument = new WeakMap<Value, readonly CommentSpan[]>();

// decorate asks on every render and each gutter on its block's, so a document is paired once
export const commentSpans = (editor: SlateEditor): readonly CommentSpan[] => {
  const cached = spansByDocument.get(editor.children);
  if (cached !== undefined) {
    return cached;
  }
  const spans = pairEdges(editor);
  spansByDocument.set(editor.children, spans);
  return spans;
};
