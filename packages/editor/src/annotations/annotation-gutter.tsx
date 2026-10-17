import { ElementApi } from "platejs";
import { createPlatePlugin, useEditorSelector } from "platejs/react";
import type { PlateElementProps, RenderNodeWrapper } from "platejs/react";
import { shallow } from "zustand/shallow";

import { getEditorHostActions } from "@repo/editor/host-io";
import { Tooltip } from "@repo/ui/components/tooltip";

import { annotationIdsByBlock, blockHoldsAnnotationMarkers } from "./annotation-ranges";

const NO_IDS: readonly string[] = [];

// A range spanning blocks draws its dot beside the block it starts in, not the one it ends in.
// Subscribed rather than read in render: an edit elsewhere can orphan an edge here without
// touching this block.
const AnnotationGutterBlock = (props: PlateElementProps) => {
  const { element } = props;
  const ids = useEditorSelector(
    (editor) => annotationIdsByBlock(editor).get(element) ?? NO_IDS,
    [element],
    { equalityFn: shallow },
  );

  if (ids.length === 0) {
    // Plate types PlateElementProps["children"] as `any`, so the fragment is what pins the
    // return to ReactNode; returning the children bare is an unsafe return.
    // oxlint-disable-next-line react/jsx-no-useless-fragment -- see above
    return <>{props.children}</>;
  }

  return (
    <div className="relative">
      <Tooltip content="Comments on this block">
        <button
          type="button"
          contentEditable={false}
          aria-label="Comments on this block"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            getEditorHostActions().annotations.open([...ids]);
          }}
          className="absolute top-[0.35em] -left-6 flex size-4 cursor-pointer items-center justify-center rounded-sm select-none hover:bg-accent print:hidden"
        >
          <span className="block size-1.5 rounded-full bg-amber-400" />
        </button>
      </Tooltip>
      {props.children}
    </div>
  );
};

const AnnotationGutterWrapper: RenderNodeWrapper = ({ element, path }) => {
  if (path.length !== 1) {
    return;
  }
  if (!ElementApi.isElement(element) || !blockHoldsAnnotationMarkers(element)) {
    return;
  }
  return function AnnotationGutterAbove(props) {
    return <AnnotationGutterBlock {...props} />;
  };
};

export const AnnotationGutterKit = [
  createPlatePlugin({
    key: "annotationGutter",
    render: { aboveNodes: AnnotationGutterWrapper },
  }),
];
