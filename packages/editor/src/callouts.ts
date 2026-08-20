// Callouts: `> [!NOTE] Title` and the rest of the `[!TYPE]` family.
//
// A lezer inline parser earns the node, and the two house seams do the rest.
// The parser fires only at the START of a paragraph's inline content, which is
// where a callout header can be — and lezer pads a blockquote's line prefixes
// with spaces rather than dropping them, so that position is the `[` itself
// with the `> ` already accounted for.
//
// Knowing WHICH paragraph it started is the one thing an inline parser cannot
// ask, so the node is emitted wherever a paragraph opens with the token and
// the DECORATIONS require the blockquote parent. A `[!NOTE]` opening an
// ordinary paragraph therefore renders as the literal text it is — the same
// outcome the bare-`[label]` link rule already produces there.
//
// Two fold specs, because they reveal on different zones: the header token is
// a replace-widget that unfolds when the selection touches IT, and the block
// chrome is line decorations that must survive editing inside the callout
// (`keepDecorationOnUnfold`), or the box would flicker away under the caret.

import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";
import { foldableSyntaxFacet } from "./vendor/prosemark/lib/fold/core";

// `[!TYPE]`, an optional `+`/`-` fold sign, and the one space separating the
// header from its title — taken with the token, so hiding it does not leave a
// leading space the user never typed the look of.
const CALLOUT_HEADER = /^\[!([A-Za-z][\w-]*)\][+-]?[ \t]?/;

// Obsidian's vocabulary collapses onto a handful of intents; the aliases are
// what a note actually carries. A type outside this table still gets its box
// and its label — an unknown callout is a callout, not a parse failure.
const CALLOUT_INTENTS = new Map([
  ["note", "note"],
  ["abstract", "note"],
  ["summary", "note"],
  ["tldr", "note"],
  ["info", "info"],
  ["todo", "info"],
  ["tip", "tip"],
  ["hint", "tip"],
  ["important", "tip"],
  ["success", "success"],
  ["check", "success"],
  ["done", "success"],
  ["question", "question"],
  ["help", "question"],
  ["faq", "question"],
  ["warning", "warning"],
  ["caution", "warning"],
  ["attention", "warning"],
  ["failure", "danger"],
  ["fail", "danger"],
  ["missing", "danger"],
  ["danger", "danger"],
  ["error", "danger"],
  ["bug", "danger"],
  ["example", "example"],
  ["quote", "quote"],
  ["cite", "quote"],
]);

const intentOf = (type: string): string => CALLOUT_INTENTS.get(type.toLowerCase()) ?? "note";

/** The `Callout` node type, at a paragraph's inline start. Registered in
 *  `markdown-language.ts`; the decorations below are what make it visible. */
export const calloutMarkdownSyntaxExtension: MarkdownConfig = {
  defineNodes: [{ name: "Callout" }],
  parseInline: [
    {
      name: "Callout",
      // Ahead of Link, which otherwise claims the `[`.
      before: "Link",
      parse: (cx, next, pos) => {
        if (next !== 91 /* [ */ || pos !== cx.offset) return -1;
        const match = CALLOUT_HEADER.exec(cx.text);
        if (match === null) return -1;
        return cx.addElement(cx.elt("Callout", pos, pos + match[0].length));
      },
    },
  ],
};

class CalloutLabelWidget extends WidgetType {
  constructor(
    /** The header's own bytes — the widget's whole identity, since both the
     * intent and the label text derive from them. */
    readonly source: string,
    readonly type: string,
  ) {
    super();
  }

  override eq(other: CalloutLabelWidget): boolean {
    return other.source === this.source;
  }

  override toDOM(): HTMLElement {
    const label = document.createElement("span");
    label.className = "cm-callout-label";
    label.dataset["callout"] = intentOf(this.type);
    label.textContent = this.type;
    return label;
  }

  // The label is not an affordance: a click through it places the caret,
  // which reveals the header exactly like every other folded construct.
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The `Callout` node opening this blockquote, or null when it opens with
 *  anything else (a nested blockquote, ordinary prose). The `>` markers are
 *  the blockquote's own children, so the first BLOCK child is the one to ask. */
function calloutHeaderOf(node: SyntaxNode): SyntaxNode | null {
  let child = node.firstChild;
  while (child !== null && child.name === "QuoteMark") child = child.nextSibling;
  if (child === null || child.name !== "Paragraph") return null;
  const header = child.firstChild;
  return header !== null && header.name === "Callout" ? header : null;
}

function calloutTypeOf(source: string): string {
  return CALLOUT_HEADER.exec(source)?.[1] ?? "note";
}

function calloutChrome(state: EditorState, node: SyntaxNodeRef): Range<Decoration>[] | undefined {
  const header = calloutHeaderOf(node.node);
  if (header === null) return undefined;
  const intent = intentOf(calloutTypeOf(state.doc.sliceString(header.from, header.to)));
  const firstLine = state.doc.lineAt(node.from).number;
  const lastLine = state.doc.lineAt(node.to).number;
  const ranges: Range<Decoration>[] = [];
  for (let number = firstLine; number <= lastLine; number += 1) {
    const classes = ["cm-callout-line"];
    if (number === firstLine) classes.push("cm-callout-first");
    if (number === lastLine) classes.push("cm-callout-last");
    ranges.push(
      Decoration.line({
        class: classes.join(" "),
        attributes: { "data-callout": intent },
      }).range(state.doc.line(number).from),
    );
  }
  return ranges;
}

const calloutLightTokens = {
  "--callout-note": "oklch(58% 0.09 250)",
  "--callout-info": "oklch(60% 0.1 220)",
  "--callout-tip": "oklch(60% 0.1 175)",
  "--callout-success": "oklch(58% 0.12 150)",
  "--callout-question": "oklch(62% 0.12 90)",
  "--callout-warning": "oklch(66% 0.14 75)",
  "--callout-danger": "oklch(56% 0.17 25)",
  "--callout-example": "oklch(56% 0.13 300)",
  "--callout-quote": "oklch(55% 0.02 260)",
  "--callout-tint": "6%",
};

const calloutDarkTokens = {
  "--callout-note": "oklch(74% 0.09 250)",
  "--callout-info": "oklch(75% 0.1 220)",
  "--callout-tip": "oklch(76% 0.09 175)",
  "--callout-success": "oklch(74% 0.11 150)",
  "--callout-question": "oklch(78% 0.12 90)",
  "--callout-warning": "oklch(80% 0.13 75)",
  "--callout-danger": "oklch(70% 0.15 25)",
  "--callout-example": "oklch(74% 0.12 300)",
  "--callout-quote": "oklch(70% 0.02 260)",
  "--callout-tint": "14%",
};

// Light base, dark under the stamped `data-theme` — the one carrier this
// package has; see the note in editor-theme.ts.
const calloutTheme = EditorView.theme({
  "&": calloutLightTokens,
  ':root[data-theme="dark"] &': calloutDarkTokens,

  ".cm-callout-line": {
    "--callout-accent": "var(--callout-note)",
    backgroundColor: "color-mix(in oklab, var(--callout-accent) var(--callout-tint), transparent)",
    borderInlineStart: "3px solid var(--callout-accent)",
    paddingInlineStart: "0.9em",
    color: "var(--editor-fg)",
  },
  // The blockquote bar would otherwise draw INSIDE the callout's own border.
  // Two class selectors, so this wins on specificity rather than on which
  // theme happened to be injected last.
  ".cm-line.cm-callout-line:before": {
    content: "none",
  },
  ".cm-callout-first": {
    borderStartStartRadius: "6px",
    borderStartEndRadius: "6px",
    paddingTop: "0.35em",
  },
  ".cm-callout-last": {
    borderEndStartRadius: "6px",
    borderEndEndRadius: "6px",
    paddingBottom: "0.35em",
  },
  ".cm-callout-label": {
    "--callout-accent": "var(--callout-note)",
    marginInlineEnd: "0.5em",
    fontSize: "0.72em",
    fontWeight: "600",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--callout-accent)",
    verticalAlign: "0.1em",
  },

  '.cm-callout-line[data-callout="info"], .cm-callout-label[data-callout="info"]': {
    "--callout-accent": "var(--callout-info)",
  },
  '.cm-callout-line[data-callout="tip"], .cm-callout-label[data-callout="tip"]': {
    "--callout-accent": "var(--callout-tip)",
  },
  '.cm-callout-line[data-callout="success"], .cm-callout-label[data-callout="success"]': {
    "--callout-accent": "var(--callout-success)",
  },
  '.cm-callout-line[data-callout="question"], .cm-callout-label[data-callout="question"]': {
    "--callout-accent": "var(--callout-question)",
  },
  '.cm-callout-line[data-callout="warning"], .cm-callout-label[data-callout="warning"]': {
    "--callout-accent": "var(--callout-warning)",
  },
  '.cm-callout-line[data-callout="danger"], .cm-callout-label[data-callout="danger"]': {
    "--callout-accent": "var(--callout-danger)",
  },
  '.cm-callout-line[data-callout="example"], .cm-callout-label[data-callout="example"]': {
    "--callout-accent": "var(--callout-example)",
  },
  '.cm-callout-line[data-callout="quote"], .cm-callout-label[data-callout="quote"]': {
    "--callout-accent": "var(--callout-quote)",
  },
});

export const calloutsExtension: Extension = [
  foldableSyntaxFacet.of({
    nodePath: "Blockquote",
    // The box is the callout's shape, not a fold of it: editing inside must
    // not dissolve the chrome the user is editing within.
    keepDecorationOnUnfold: true,
    buildDecorations: (state, node) => calloutChrome(state, node),
  }),
  foldableSyntaxFacet.of({
    nodePath: "Blockquote/Paragraph/Callout",
    buildDecorations: (state, node) => {
      const source = state.doc.sliceString(node.from, node.to);
      return Decoration.replace({
        widget: new CalloutLabelWidget(source, calloutTypeOf(source)),
      }).range(node.from, node.to);
    },
  }),
  calloutTheme,
];
