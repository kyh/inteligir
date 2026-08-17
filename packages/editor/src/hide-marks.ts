import type { Extension, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import {
  type HidableNodeSpec,
  hidableNodeFacet,
  hideInlineDecoration,
} from "./vendor/prosemark/lib/hide/core";
import { selectionTouchesRange, stateWORDAt } from "./vendor/prosemark/lib/utils";

const renderedLinkDecoration = Decoration.mark({ class: "cm-rendered-link" });
const inlineCodeDecoration = Decoration.mark({ class: "cm-inline-code" });

// The link's non-label children, hidden per child so every form renders as its
// label alone: inline `[l](url "title")` hides URL and LinkTitle, reference
// `[l][id]` hides the LinkLabel, and LinkMark covers the brackets and parens.
const HIDDEN_LINK_CHILDREN = new Set(["LinkMark", "URL", "LinkTitle", "LinkLabel"]);

// The first-cut hide surface, declared here rather than taken from ProseMark's
// default list because ATX headings get the house margin-hang treatment
// (heading-margin-marks.ts) instead of upstream's hide-the-hash spec.
const hideSpecs: HidableNodeSpec[] = [
  {
    nodeName: (name) => name.startsWith("SetextHeading"),
    subNodeNameToHide: "HeaderMark",
    block: true,
  },
  {
    nodeName: ["StrongEmphasis", "Emphasis"],
    subNodeNameToHide: "EmphasisMark",
  },
  {
    nodeName: "InlineCode",
    nodeDecoration: inlineCodeDecoration,
    subNodeNameToHide: "CodeMark",
  },
  {
    nodeName: "Link",
    onHide: (_state, node) => {
      const hidden: Range<Decoration>[] = [];
      let hasDestination = false;
      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name === "URL" || child.name === "LinkLabel") {
          hasDestination = true;
        }
        if (HIDDEN_LINK_CHILDREN.has(child.name)) {
          hidden.push(hideInlineDecoration.range(child.from, child.to));
        }
      }
      // A bare `[label]` names no destination — it is not a rendered link, so
      // hiding its brackets would silently eat literal text.
      if (!hasDestination) return undefined;
      hidden.push(renderedLinkDecoration.range(node.from, node.to));
      return hidden;
    },
  },
  {
    nodeName: "Strikethrough",
    subNodeNameToHide: "StrikethroughMark",
  },
  {
    nodeName: "Escape",
    subNodeNameToHide: "EscapeMark",
    // Reveal the backslash while the caret works the surrounding word, not
    // just the two escape characters — same zone upstream uses. The zone is
    // recomputed for every Escape node on every rebuild, and it only ever
    // widens to the containing line — so when no selection range touches the
    // line, the line itself answers (same hide/reveal outcome) and the
    // per-cluster WORD scan is skipped.
    unhideZone: (state, node) => {
      const line = state.doc.lineAt(node.from);
      if (!selectionTouchesRange(state.selection.ranges, line)) return line;
      const wordAt = stateWORDAt(state, node.from);
      if (wordAt && wordAt.to > node.from + 1) return wordAt;
      return line;
    },
  },
  {
    nodeName: "FencedCode",
    subNodeNameToHide: ["CodeMark", "CodeInfo"],
    keepSpace: true,
  },
  {
    nodeName: "Blockquote",
    subNodeNameToHide: "QuoteMark",
    keepSpace: true,
  },
];

/** Mark hiding for inline constructs; reveal-on-selection, never atomicRanges. */
export const hideMarksExtension: Extension = hideSpecs.map((spec) => hidableNodeFacet.of(spec));
