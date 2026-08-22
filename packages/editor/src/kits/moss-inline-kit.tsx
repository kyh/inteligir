// Moss inline constructs: formula/variable pills and comment anchors, as
// inline-void nodes over the dialect @repo/notes/markdown/remark-moss-inline
// owns (that file states the round-trip contract; the vendored moss-skills
// state the grammar).
//
//   {{source|display|meta}}  → mossFormula   — a computed pill; shows the
//     display half (the persisted result), falling back to the source.
//     Evaluation, editing and the typeahead land with the formulas engine
//     (#585) — until then the pill is faithful, read-only rendering.
//   %%m:ids:start/end%%      → mossCommentMarker — an anchored-comment
//     boundary. Renders nothing visible: the marker is plumbing for the
//     comment surface (#583), and drawing brackets in prose would put the
//     mechanism where the annotation belongs. The bytes stay exact.

import { createSlatePlugin } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";

const mossFormulaBasePlugin = createSlatePlugin({
  key: "mossFormula",
  node: { isElement: true, isInline: true, isVoid: true },
});

const mossCommentMarkerBasePlugin = createSlatePlugin({
  key: "mossCommentMarker",
  node: { isElement: true, isInline: true, isVoid: true },
});

export const MossInlineBaseKit = [mossFormulaBasePlugin, mossCommentMarkerBasePlugin];

function formulaLabel(element: PlateElementProps["element"]): string {
  const display = typeof element.display === "string" ? element.display : "";
  if (display !== "") return display;
  return typeof element.source === "string" ? element.source : "";
}

function MossFormulaElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="span" className="inline-block">
      <span
        contentEditable={false}
        className="cursor-default rounded-sm bg-accent px-1 font-medium text-accent-foreground tabular-nums"
      >
        {formulaLabel(props.element)}
      </span>
      {props.children}
    </PlateElement>
  );
}

function MossCommentMarkerElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="span" className="inline-block">
      <span contentEditable={false} aria-hidden className="sr-only" />
      {props.children}
    </PlateElement>
  );
}

export const MossInlineKit = [
  mossFormulaBasePlugin.withComponent(MossFormulaElement),
  mossCommentMarkerBasePlugin.withComponent(MossCommentMarkerElement),
];
