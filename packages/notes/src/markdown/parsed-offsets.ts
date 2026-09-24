// micromark drops a leading BOM before it counts, so every offset a parse reports falls short of
// its source's by the BOM's length. Each parse here rebases its tree through this one pass, so an
// offset always names the bytes of the string the caller handed in.

import type { Nodes } from "mdast";

export const BOM = "\uFEFF";

type Positioned = Pick<Nodes, "position">;
type Point = NonNullable<Positioned["position"]>["start"];

const shiftPoint = (point: Point, shift: number): Point =>
  point.offset === undefined ? point : { ...point, offset: point.offset + shift };

// a fresh position rather than an in-place bump: a transformer may hand one point object to a
// node and its parent, and mutating it would shift that point twice.
const shiftPosition = (node: Positioned, shift: number): void => {
  const { position } = node;
  if (position !== undefined) {
    node.position = {
      ...position,
      end: shiftPoint(position.end, shift),
      start: shiftPoint(position.start, shift),
    };
  }
};

const shiftTree = (node: Nodes, shift: number): void => {
  shiftPosition(node, shift);
  // jsx attributes carry positions but are not children
  if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
    for (const attribute of node.attributes) {
      shiftPosition(attribute, shift);
    }
  }
  if ("children" in node) {
    for (const child of node.children) {
      shiftTree(child, shift);
    }
  }
};

export const rebaseParsedOffsets = (tree: Nodes, source: string): void => {
  if (source.startsWith(BOM)) {
    shiftTree(tree, BOM.length);
  }
};
