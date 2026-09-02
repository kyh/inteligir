// Parsed, not regexed: a marker inside a code fence is literal in the editor and must be here too.

import type { Nodes } from "mdast";

import { parseMdast } from "../markdown/parse";

// null when the doc does not parse: answering "none" would let a cleanup pass delete every thread
export function markerRootIds(source: string): Set<string> | null {
  const parsed = parseMdast(source);
  if (!parsed.ok) return null;
  const ids = new Set<string>();
  walk(parsed.root, (node) => {
    if (node.type !== "commentMarker") return;
    for (const id of node.ids.split(",")) {
      if (id !== "") ids.add(id);
    }
  });
  return ids;
}

function walk(node: Nodes, visitor: (node: Nodes) => void): void {
  visitor(node);
  if ("children" in node) {
    for (const child of node.children) walk(child, visitor);
  }
}
