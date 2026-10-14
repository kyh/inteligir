// Parsed, not regexed: a marker inside a code fence is literal in the editor and must be here too.

import { visit } from "unist-util-visit";

import { parseMdast } from "../markdown/parse";
import { splitMarkerIds } from "../markdown/remark-inline-constructs";

export const markerRootIds = (source: string): Set<string> => {
  const ids = new Set<string>();
  visit(parseMdast(source).root, "commentMarker", (node) => {
    for (const id of splitMarkerIds(node.ids)) {
      ids.add(id);
    }
  });
  return ids;
};
