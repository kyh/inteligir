// Which comment roots the note's BODY anchors. Extraction runs the same parse
// the editor's pipeline runs (remark-moss-inline's nodes), so a marker inside
// a code fence or a `moss-*` payload stays literal here exactly as it renders
// there — a raw regex over the source would count what the dialect says is
// not a marker.

import type { Nodes } from "mdast";

import { parseMdast } from "../markdown/parse";

/** Root ids named by any body marker (start and end edges union — a lone edge
 * is malformed, but the id it names still deserves a sidecar match rather
 * than a silent drop). Answers null when the doc does not parse: an
 * unparseable doc has no marker answer, and pretending "none" would let a
 * cleanup pass delete every thread. */
export function markerRootIds(source: string): Set<string> | null {
  const parsed = parseMdast(source);
  if (!parsed.ok) return null;
  const ids = new Set<string>();
  walk(parsed.root, (node) => {
    if (node.type !== "mossCommentMarker") return;
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
