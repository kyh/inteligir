import type { Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { hidableNodeFacet } from "./vendor/prosemark/lib/hide/core";

const headingLineDecoration = Decoration.line({ class: "cm-heading-hang" });
const headingHashDecoration = Decoration.mark({ class: "cm-heading-hash" });

const headingMarginTheme = EditorView.theme({
  ".cm-heading-hang": {
    position: "relative",
  },
  // The hashes hang in the left margin instead of vanishing: absolute
  // positioning takes them out of flow, so the heading text aligns with body
  // text while the level stays readable. Line decoration + mark on the same
  // range; CodeMirror merges the classes.
  ".cm-heading-hash": {
    position: "absolute",
    right: "100%",
    top: "0",
    whiteSpace: "pre",
    paddingRight: "0.5em",
    fontSize: "0.75em",
    fontWeight: "400",
    color: "var(--pm-header-mark-color)",
  },
});

/**
 * ATX heading treatment: while the selection is off the heading line, the
 * `#` marks hang in the left margin; touching the line restores them inline.
 */
export const headingMarginMarksExtension: Extension = [
  hidableNodeFacet.of({
    nodeName: (name) => name.startsWith("ATXHeading"),
    onHide: (state, node) => {
      const headerMark = node.node.firstChild;
      if (!headerMark || headerMark.name !== "HeaderMark") return undefined;
      // Take the space after the marks with them; a bare `#` line stays raw
      // (hanging its only content would collapse the line box).
      const hashTo = headerMark.to + 1;
      if (hashTo >= node.to) return undefined;
      const line = state.doc.lineAt(node.from);
      return [
        headingLineDecoration.range(line.from),
        headingHashDecoration.range(headerMark.from, hashTo),
      ];
    },
  }),
  headingMarginTheme,
];
