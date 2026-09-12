import { ElementApi } from "platejs";
import { createPlatePlugin, useEditorRef } from "platejs/react";
import type { PlateElementProps, RenderNodeWrapper } from "platejs/react";

import { useOpenNotePath } from "@repo/editor/note/open-note-context";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";

import { holdsCommentMarkers, scanBlockComments } from "./comment-ranges";
import { useCommentMeta, useCommentSurface } from "./comment-store";

const CommentGutterBlock = (props: PlateElementProps) => {
  const editor = useEditorRef();
  const actions = useCommentSurface((state) => state.actions);
  const notePath = useOpenNotePath();
  const { resolvedIds } = useCommentMeta(notePath);
  const { path } = props;
  const scan =
    path === undefined
      ? { ranges: [], unpairedIds: [] }
      : scanBlockComments(editor, [props.element, path]);
  const ids = [...new Set([...scan.ranges.flatMap((range) => range.ids), ...scan.unpairedIds])];

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
  if (!ElementApi.isElement(element) || !holdsCommentMarkers(element)) {
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
