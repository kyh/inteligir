import { ElementApi } from "platejs";
import { createPlatePlugin, useEditorSelector } from "platejs/react";
import type { PlateElementProps, RenderNodeWrapper } from "platejs/react";
import { shallow } from "zustand/shallow";

import { useOpenNotePath } from "@repo/editor/note/open-note-context";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";

import { blockHoldsCommentMarkers, commentSpans } from "./comment-ranges";
import { useCommentMeta, useCommentSurface } from "./comment-store";

// A range spanning blocks draws its dot beside the block it starts in, not the one it ends in.
// Subscribed rather than read in render: an edit elsewhere can orphan an edge here without
// touching this block.
const CommentGutterBlock = (props: PlateElementProps) => {
  const { element } = props;
  const actions = useCommentSurface((state) => state.actions);
  const notePath = useOpenNotePath();
  const { resolvedIds } = useCommentMeta(notePath);
  const ids = useEditorSelector(
    (editor) => [
      ...new Set(
        commentSpans(editor)
          .filter((span) => span.block === element)
          .flatMap((span) => span.ids),
      ),
    ],
    [element],
    { equalityFn: shallow },
  );

  if (ids.length === 0) {
    // Plate types PlateElementProps["children"] as `any`, so the fragment is what pins the
    // return to ReactNode; returning the children bare is an unsafe return.
    // oxlint-disable-next-line react/jsx-no-useless-fragment -- see above
    return <>{props.children}</>;
  }

  const allResolved = ids.every((id) => resolvedIds.has(id));
  return (
    <div className="relative">
      <Tooltip content={allResolved ? "Resolved comments on this block" : "Comments on this block"}>
        <button
          type="button"
          contentEditable={false}
          aria-label={allResolved ? "Resolved comments on this block" : "Comments on this block"}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            actions?.open(ids);
          }}
          className="absolute top-[0.35em] -left-6 flex size-4 cursor-pointer items-center justify-center rounded-sm select-none hover:bg-accent print:hidden"
        >
          <span
            className={cn(
              "block size-1.5 rounded-full",
              allResolved ? "bg-emerald-500/50" : "bg-amber-400",
            )}
          />
        </button>
      </Tooltip>
      {props.children}
    </div>
  );
};

const CommentGutterWrapper: RenderNodeWrapper = ({ element, path }) => {
  if (path.length !== 1) {
    return;
  }
  if (!ElementApi.isElement(element) || !blockHoldsCommentMarkers(element)) {
    return;
  }
  return function CommentGutterAbove(props) {
    return <CommentGutterBlock {...props} />;
  };
};

export const CommentGutterKit = [
  createPlatePlugin({
    key: "commentGutter",
    render: { aboveNodes: CommentGutterWrapper },
  }),
];
