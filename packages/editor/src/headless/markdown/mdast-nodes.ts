import type { Node, Root } from "mdast";

export const isMdastRoot = (node: Node): node is Root => node.type === "root";
