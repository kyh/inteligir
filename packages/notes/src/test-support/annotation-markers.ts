// The suites' oracles for a highlight's markers, beside the placement every device runs
// (`../annotations/place-quotes.ts`): the ids a doc's markers name, read by the dialect's own
// parser rather than the placement's projection, so a property can hold the two to each other, and
// a doc with an id's markers spliced back out, so one can hold a placement to splicing markers
// alone. Parsed, not regexed: a marker inside a code fence is literal in the editor and here too.

import { visit } from "unist-util-visit";

import { projectPassages } from "../annotations/passage-text";
import { parseMdast } from "../markdown/parse";
import { splitMarkerIds } from "../markdown/remark-inline-constructs";

export const markerRootIds = (source: string): Set<string> => {
  const ids = new Set<string>();
  visit(parseMdast(source).root, "annotationMarker", (node) => {
    for (const id of splitMarkerIds(node.ids)) {
      ids.add(id);
    }
  });
  return ids;
};

// the markers naming any of `ids` spliced out: a pair the ids share with others keeps the others
export const stripAnnotationMarkers = (content: string, ids: readonly string[]): string => {
  const removing = new Set(ids);
  let out = "";
  let cursor = 0;
  for (const marker of projectPassages(content).markerSpans) {
    const listed = splitMarkerIds(marker.ids);
    if (!listed.some((id) => removing.has(id))) {
      continue;
    }
    const kept = listed.filter((id) => !removing.has(id));
    out += content.slice(cursor, marker.start);
    out += kept.length === 0 ? "" : `%%i:${kept.join(",")}:${marker.edge}%%`;
    cursor = marker.end;
  }
  return out + content.slice(cursor);
};
