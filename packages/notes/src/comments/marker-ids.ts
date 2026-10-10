// Parsed, not regexed: a marker inside a code fence is literal in the editor and must be here too.

import type { Nodes } from "mdast";

import { parseMdast } from "../markdown/parse";
import { splitMarkerIds } from "../markdown/remark-inline-constructs";

const walk = (node: Nodes, visitor: (node: Nodes) => void): void => {
  visitor(node);
  if ("children" in node) {
    for (const child of node.children) {
      walk(child, visitor);
    }
  }
};

export const markerRootIds = (source: string): Set<string> => {
  const parsed = parseMdast(source);
  const ids = new Set<string>();
  walk(parsed.root, (node) => {
    if (node.type !== "commentMarker") {
      return;
    }
    for (const id of splitMarkerIds(node.ids)) {
      ids.add(id);
    }
  });
  return ids;
};
