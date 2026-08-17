// Which spans in the BUFFER are delegation markers, read off the Lezer tree the
// editor already maintains.
//
// @repo/notes' `findThreadMarkers` is the vault's answer and stays the
// authoritative one — but it is a full remark parse (~78ms on a 50KB note here),
// and the chip decorations rebuild on every keystroke. The editor has the same
// document already parsed, incrementally, so it asks that instead.
//
// The two grammars agree on every marker this product writes, and where they
// differ this one is a SUBSET: lezer keeps CommonMark's `codeIndented` and
// `htmlFlow`, which ../notes' scan disables (for the checkbox-ordinal
// agreement), and both differences make lezer see a code or HTML block where
// the scan sees a comment. Containment in that direction is the safe one — the
// editor declining to chip an anchor leaves the user's own bytes on screen,
// where chipping a span the vault does NOT consider an anchor would hide text
// that a dismiss then deletes. __tests__/thread-marker-parity.test.ts pins both
// halves: equality over the markers the product produces, containment over the
// rest.

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { ThreadMarker } from "@repo/notes/markdown/thread-marker";

const MARKER_VALUE_RE = /^<!-- inteligir:thread (anc_[0-9a-f]{12}) -->$/u;

// A block-level comment nests only inside these, so everything else is pruned
// rather than descended: the walk costs one visit per block, not one per node.
const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

/** Every marker in the buffer, in source order. */
export function threadMarkerNodes(state: EditorState): ThreadMarker[] {
  const markers: ThreadMarker[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "CommentBlock") {
        return CONTAINERS.has(node.name);
      }
      const matched = MARKER_VALUE_RE.exec(state.doc.sliceString(node.from, node.to));
      const anchor = matched?.[1];
      if (anchor === undefined) {
        return false;
      }
      // Alone on its line: a container prefix may precede it, prose may not —
      // the same rule the scan applies, for the same reason.
      const line = state.doc.lineAt(node.from);
      const before = state.doc.sliceString(line.from, node.from);
      const after = state.doc.sliceString(node.to, line.to);
      if (!/^[\s>]*$/u.test(before) || after.trim() !== "") {
        return false;
      }
      markers.push({ anchor, from: node.from, to: node.to });
      return false;
    },
  });
  return markers;
}
