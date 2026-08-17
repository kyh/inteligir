// TeX math: `$…$` inline and `$$…$$` display, rendered with KaTeX.
//
// KaTeX rather than MathJax because `renderToString` is SYNCHRONOUS. This is a
// per-keystroke surface: a widget that had to await its renderer would need an
// honest `estimatedHeight`, a measure nudge and a placeholder for every formula
// in the viewport, and the document would reflow under the caret as each one
// settled. Sync rendering makes the widget's height correct the moment it
// mounts, so none of that machinery has to exist.
//
// KaTeX's OUTPUT is not user HTML: with `trust` at its default `false` it
// emits no URLs and no raw markup — every token is escaped through its own
// builder — so `innerHTML` here is the renderer's own tree, not the note's
// bytes. (The mermaid path is the opposite case and sanitizes.)
//
// The one thing sync rendering cannot fix is FONTS: KaTeX lays out against
// metrics that change when its woff2 faces arrive, so the extension nudges one
// measure pass per view once `document.fonts` settles.

import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";
import { isInlineMathNode } from "./vendor/prosemark/lib/markdown/mathMarkdown";
import { foldableSyntaxFacet } from "./vendor/prosemark/lib/fold/core";

/** `$$…$$` is display math; a TIGHT `$…$` is inline. A padded `$ x $` is
 *  neither — the delimiters have to hug, so that span is ordinary text and
 *  gets no widget at all. */
type MathKind = "display" | "inline";

function renderMath(host: HTMLElement, tex: string, source: string, display: boolean): void {
  try {
    // `strict: false` keeps KaTeX from console-warning about constructs it
    // renders correctly anyway; the default htmlAndMathml output is kept so
    // the formula reaches a screen reader as MathML.
    host.innerHTML = katex.renderToString(tex, { displayMode: display, throwOnError: true });
  } catch (error) {
    // Never an empty gap: the source the user wrote, and why it did not
    // render, both stay on screen.
    host.replaceChildren();
    host.classList.add("cm-math-error");
    const literal = document.createElement("code");
    literal.className = "cm-math-error-source";
    literal.textContent = source;
    const message = document.createElement("span");
    message.className = "cm-math-error-message";
    message.textContent = error instanceof Error ? error.message : String(error);
    host.append(literal, message);
  }
}

class MathWidget extends WidgetType {
  constructor(
    /** The formula's own bytes, delimiters included — the widget's whole
     * identity, since the display flag and the TeX both derive from them. */
    readonly source: string,
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }

  override eq(other: MathWidget): boolean {
    return other.source === this.source;
  }

  override toDOM(): HTMLElement {
    const host = document.createElement(this.display ? "div" : "span");
    host.className = this.display ? "cm-math cm-math-display" : "cm-math cm-math-inline";
    renderMath(host, this.tex, this.source, this.display);
    return host;
  }

  // Not an affordance: a click places the caret, which reveals the source
  // like every other folded construct.
  override ignoreEvent(): boolean {
    return false;
  }
}

// One measure pass per view, once the KaTeX faces have loaded. Without it the
// first formulas are laid out against fallback metrics and CodeMirror keeps
// the heights it measured then.
const mathFontMeasure = ViewPlugin.fromClass(
  class {
    private destroyed = false;

    constructor(view: EditorView) {
      void document.fonts?.ready.then(() => {
        if (!this.destroyed) view.requestMeasure();
        return undefined;
      });
    }

    destroy(): void {
      this.destroyed = true;
    }
  },
);

const mathTheme = EditorView.theme({
  ".cm-math-display": {
    display: "block",
    textAlign: "center",
  },
  ".cm-math-error": {
    color: "var(--pm-syntax-invalid)",
  },
  ".cm-math-error-source": {
    fontFamily: "var(--pm-code-font)",
    fontSize: "0.85em",
  },
  ".cm-math-error-message": {
    marginInlineStart: "0.6em",
    fontSize: "0.75em",
    opacity: "0.8",
  },
});

export const mathExtension: Extension = [
  foldableSyntaxFacet.of({
    nodePath: "Math",
    buildDecorations: (state, node) => {
      const source = state.doc.sliceString(node.from, node.to);
      const kind: MathKind | null = source.startsWith("$$")
        ? "display"
        : isInlineMathNode(state, node.from, node.to)
          ? "inline"
          : null;
      if (kind === null) return undefined;
      const formula = node.node.getChild("MathFormula");
      const tex = formula === null ? "" : state.doc.sliceString(formula.from, formula.to);
      // A display formula alone on its lines replaces them as a BLOCK widget;
      // `$$x$$` sitting inside a sentence stays inline, display-styled.
      const block =
        kind === "display" &&
        node.from === state.doc.lineAt(node.from).from &&
        node.to === state.doc.lineAt(node.to).to;
      return Decoration.replace({
        widget: new MathWidget(source, tex, kind === "display"),
        block,
      }).range(node.from, node.to);
    },
  }),
  mathFontMeasure,
  mathTheme,
];
