import { ElementApi } from "platejs";
import { createPlatePlugin, useEditorSelector } from "platejs/react";
import type { PlateElementProps, RenderNodeWrapper } from "platejs/react";
import { shallow } from "zustand/shallow";

import { getEditorHostActions } from "@repo/editor/host-io";
import { useOpenNotePath } from "@repo/editor/note/open-note-context";
import { Tooltip } from "@repo/ui/components/tooltip";

import { annotationIdsByBlock, blockHoldsAnnotationMarkers } from "./annotation-ranges";
import { useAnnotationMeta } from "./annotation-store";

const NO_IDS: readonly string[] = [];
const NONE_NOTED: ReadonlySet<string> = new Set();

// A range spanning blocks draws its dot beside the block it starts in, not the one it ends in.
// Subscribed rather than read in render: an edit elsewhere can orphan an edge here without
// touching this block. Only a highlight with a note or a reply has a dot: a bare highlight is
// its tint alone, which already says where it is.
const AnnotationGutterBlock = (props: PlateElementProps) => {
  const { element } = props;
  const ids = useEditorSelector(
    (editor) => annotationIdsByBlock(editor).get(element) ?? NO_IDS,
    [element],
    { equalityFn: shallow },
  );
  const notePath = useOpenNotePath();
  const { notedIds = NONE_NOTED } = useAnnotationMeta(notePath);
  const noted = ids.filter((id) => notedIds.has(id));

  // the wrapper stays while the block holds markers, so a note landing on a highlight adds a dot
  // without remounting the block under the caret
  return (
    <div className="relative">
      {noted.length === 0 ? null : (
        <Tooltip content="Highlights on this block">
          <button
            type="button"
            contentEditable={false}
            aria-label="Highlights on this block"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              getEditorHostActions().annotations.open(noted);
            }}
            className="absolute top-[0.35em] -left-6 flex size-4 cursor-pointer items-center justify-center rounded-sm select-none hover:bg-accent print:hidden"
          >
            <span className="block size-1.5 rounded-full bg-yellow-500" />
          </button>
        </Tooltip>
      )}
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
