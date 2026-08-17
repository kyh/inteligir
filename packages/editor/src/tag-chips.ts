// Inline `#tag` chips. A MARK decoration, never a replace: the `#` and the
// name stay on screen as the user's own bytes, so there is nothing to reveal
// on selection and nothing for the drag-freeze seam to defer — the chip is
// styling over text that never moves.
//
// Which spans ARE tags is `@repo/notes/knowledge/link-extract`'s answer, the
// same scanner the knowledge index projects with, so a chip and a `tag:` hit
// can never disagree about what a tag is. That scanner is pure string math;
// what it cannot know is CONTEXT, so the syntax tree answers that half — a
// `#tag` inside code, a URL or a link label is literal text there, exactly as
// the index's mdast walk treats it.

import { syntaxTree } from "@codemirror/language";
import { Facet, RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { inlineTagSpans } from "@repo/notes/knowledge/link-extract";

/** Receives the tag NAME (no `#`) of a clicked chip. */
export type TagClickHandler = (tag: string) => void;

export const tagClickHandler = Facet.define<TagClickHandler>();

const tagDecoration = Decoration.mark({ class: "cm-tag" });

// The index excludes tags in code spans and fences, in a link or image URL,
// and inside a link or image LABEL. Those are mdast facts there and lezer node
// names here; this set is the translation, and the one place it lives.
const NON_TAG_NODES = new Set([
  "InlineCode",
  "CodeText",
  "CodeBlock",
  "FencedCode",
  "Comment",
  "CommentBlock",
  "HTMLTag",
  "HTMLBlock",
  "URL",
  "Autolink",
  "LinkTitle",
  "LinkLabel",
  "LinkReference",
  "Link",
  "Image",
  "Frontmatter",
]);

/** True when the tree says this position is prose rather than code, a URL or a
 *  link label. Resolved one character IN, so the enclosing node is the token's
 *  own rather than whatever abuts its left edge. */
function isTagTerritory(state: EditorState, from: number): boolean {
  let node = syntaxTree(state).resolveInner(from + 1, 1);
  for (;;) {
    if (NON_TAG_NODES.has(node.name)) return false;
    const parent = node.parent;
    if (parent === null) return true;
    node = parent;
  }
}

/** The tag token covering `pos`, or null. The chip's DOM carries no state, so
 *  the click path re-derives its answer from the buffer. */
function tagAt(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  for (const span of inlineTagSpans(line.text)) {
    const from = line.from + span.start;
    if (pos < from || pos > line.from + span.end) continue;
    return isTagTerritory(state, from) ? span.tag : null;
  }
  return null;
}

function buildTagDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  // Two visible ranges can share a line, and the builder demands ascending,
  // non-overlapping adds — so a line already emitted is never emitted twice.
  let emittedTo = -1;
  for (const range of view.visibleRanges) {
    let pos = range.from;
    while (pos <= range.to) {
      const line = doc.lineAt(pos);
      if (line.from > emittedTo) {
        for (const span of inlineTagSpans(line.text)) {
          const from = line.from + span.start;
          if (isTagTerritory(view.state, from)) {
            builder.add(from, line.from + span.end, tagDecoration);
          }
        }
        emittedTo = line.to;
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

// A ViewPlugin, and the layout rule permits it: these are inline marks over
// the visible ranges, never a block widget or a cross-line replace.
const tagChipsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildTagDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildTagDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// mousedown, matching the rendered-link gesture next door, and deliberately
// NOT consumed: the caret still lands where it was clicked, so a chip is
// editable text that also acts.
const tagClickExtension = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    if (!(event.target instanceof Element) || event.target.closest(".cm-tag") === null) {
      return false;
    }
    const pos = view.posAtCoords(event);
    if (pos === null) return false;
    const tag = tagAt(view.state, pos);
    if (tag === null) return false;
    for (const handler of view.state.facet(tagClickHandler)) {
      handler(tag);
    }
    return false;
  },
});

const tagTheme = EditorView.theme({
  ".cm-tag": {
    padding: "0.05em 0.45em",
    borderRadius: "999px",
    fontSize: "0.9em",
    color: "var(--pm-link-color)",
    backgroundColor: "var(--pm-code-background-color)",
    cursor: "pointer",
  },
  ".cm-tag:hover": {
    backgroundColor: "var(--pm-code-btn-background-color)",
  },
});

/** Inline `#tag` chips, plus the click that hands the tag name to the app. */
export const tagChipsExtension: Extension = [tagChipsPlugin, tagClickExtension, tagTheme];
