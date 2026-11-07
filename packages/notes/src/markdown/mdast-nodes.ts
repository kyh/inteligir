import type { Node, Root } from "mdast";

// unified types a transform's input as a bare `Node` when no plugin refined the generics.
export const isMdastRoot = (node: Node): node is Root => node.type === "root";
