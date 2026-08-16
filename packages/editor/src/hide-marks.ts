import type { Extension } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { type HidableNodeSpec, hidableNodeFacet } from "./vendor/prosemark/lib/hide/core";
import { stateWORDAt } from "./vendor/prosemark/lib/utils";

const renderedLinkDecoration = Decoration.mark({ class: "cm-rendered-link" });
const inlineCodeDecoration = Decoration.mark({ class: "cm-inline-code" });

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
    subNodeNameToHide: ["LinkMark", "URL"],
    onHide: (_state, node) => renderedLinkDecoration.range(node.from, node.to),
  },
  {
    nodeName: "Strikethrough",
    subNodeNameToHide: "StrikethroughMark",
  },
  {
    nodeName: "Escape",
    subNodeNameToHide: "EscapeMark",
    // Reveal the backslash while the caret works the surrounding word, not
    // just the two escape characters — same zone upstream uses.
    unhideZone: (state, node) => {
      const wordAt = stateWORDAt(state, node.from);
      if (wordAt && wordAt.to > node.from + 1) return wordAt;
      return state.doc.lineAt(node.from);
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
