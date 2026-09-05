import { ElementApi } from "platejs";
import {
  createPlatePlugin,
  useEditorRef,
  type PlateElementProps,
  type RenderNodeWrapper,
} from "platejs/react";

import { useOpenNotePath } from "@repo/editor/note/open-note-context";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";

import { holdsCommentMarkers, scanBlockComments } from "./comment-ranges";
import { useCommentMeta, useCommentSurface } from "./comment-store";

function CommentGutterBlock(props: PlateElementProps) {
  const editor = useEditorRef();
  const actions = useCommentSurface((state) => state.actions);
  const notePath = useOpenNotePath();
  const { resolvedIds } = useCommentMeta(notePath);
  const path = props.path;
  const scan =
    path === undefined
      ? { ranges: [], unpairedIds: [] }
      : scanBlockComments(editor, [props.element, path]);
  const ids = [...new Set([...scan.ranges.flatMap((range) => range.ids), ...scan.unpairedIds])];

  if (ids.length === 0) return <>{props.children}</>;

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
}

const CommentGutterWrapper: RenderNodeWrapper = ({ element, path }) => {
  if (path.length !== 1) return undefined;
  if (!ElementApi.isElement(element) || !holdsCommentMarkers(element)) return undefined;
  return (props) => <CommentGutterBlock {...props} />;
};

export const CommentGutterKit = [
  createPlatePlugin({
    key: "commentGutter",
    render: { aboveNodes: CommentGutterWrapper },
  }),
];
