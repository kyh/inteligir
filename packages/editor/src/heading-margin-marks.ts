import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

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
  //
  // THE GUTTER IS SIZED IN THE EDITOR'S OWN BASE, never in `em`. An `em` here
  // is the HEADING's size, so the mark and the gap it hangs by would grow with
  // the level — a ragged gutter whose only alignment was the accident of
  // right-aligning it. One size and one gap put every level's marks on the
  // same two edges.
  ".cm-heading-hash": {
    position: "absolute",
    right: "100%",
    top: "0",
    whiteSpace: "pre",
    paddingRight: "calc(var(--editor-size, 1rem) * 0.55)",
    fontSize: "calc(var(--editor-size, 1rem) * 0.8)",
    lineHeight: "inherit",
    fontWeight: "400",
    color: "var(--pm-header-mark-color)",
  },
});

function buildHeadingMarks(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!node.type.name.startsWith("ATXHeading")) {
        return;
      }
      const headerMark = node.node.firstChild;
      if (headerMark === null || headerMark.name !== "HeaderMark") {
        return;
      }
      // Take the space after the marks with them; a bare `#` line stays raw
      // (hanging its only content would collapse the line box).
      const hashTo = headerMark.to + 1;
      if (hashTo >= node.to) {
        return;
      }
      const line = state.doc.lineAt(node.from);
      ranges.push(
        headingLineDecoration.range(line.from),
        headingHashDecoration.range(headerMark.from, hashTo),
      );
    },
  });
  return Decoration.set(ranges, true);
}

/**
 * ATX heading treatment: the `#` marks hang in the left margin, so a heading's
 * text starts on the same edge as body text at every level.
 *
 * THE HANG DOES NOT DEPEND ON THE SELECTION, which is why this is a field of
 * its own rather than a row in the hide facet. That facet restores a mark
 * inline while the caret touches its node — right for `**bold**`, wrong here:
 * it put the heading's text back behind the hashes, so the column's left edge
 * moved as the caret travelled, and a cold open (caret at offset 0) landed on
 * the shifted state every time. The marks stay real, selectable text either
 * way; only where they are drawn changes.
 */
export const headingMarginField = StateField.define<DecorationSet>({
  create: buildHeadingMarks,
  update(marks, tr) {
    if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return buildHeadingMarks(tr.state);
    }
    return marks.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const headingMarginMarksExtension: Extension = [headingMarginField, headingMarginTheme];
