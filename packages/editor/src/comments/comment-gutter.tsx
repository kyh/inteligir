// The margin's claim that a block carries comments: a small dot in the left
// gutter — amber while any thread is open, faint green once every thread on
// the block is resolved — whose click is the SAME open the tinted range
// answers. Rides the aboveNodes wrapper seam heading-collapse uses; only
// blocks that actually hold markers get wrapped, so the walk the tint already
// runs per block is re-asked, never re-invented.

import { ElementApi } from "platejs";
import {
  createPlatePlugin,
  useEditorRef,
  type PlateElementProps,
  type RenderNodeWrapper,
} from "platejs/react";

import { openDocPath } from "@repo/editor/note/open-doc";
import { useOpenNote } from "@repo/editor/note/open-note-context";
import { cn } from "@repo/ui/lib/utils";

import { holdsCommentMarkers, scanBlockComments } from "./comment-ranges";
import { useCommentMeta, useCommentSurface } from "./comment-store";

function CommentGutterBlock(props: PlateElementProps) {
  const editor = useEditorRef();
  const actions = useCommentSurface((state) => state.actions);
  const notePath = useOpenNote((s) => openDocPath(s.openDoc));
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
