// Block hover gutter — a slimmed adaptation of Potion's block-draggable.tsx.
// Each top-level block gets a left gutter (revealed on hover) with a "+" to
// insert a block below and open the slash menu, and a grip to drag-reorder.
// Dropped from potion: multi-block selection, the block context menu, drag
// previews, and column/table handling (features we don't have). Reordering
// blocks just reorders markdown lines, so it stays round-trip safe.

import { DndPlugin, useDraggable, useDropLine } from "@platejs/dnd";
import { GripVerticalIcon, PlusIcon } from "lucide-react";
import { PathApi } from "platejs";
import {
  MemoizedChildren,
  type PlateElementProps,
  type RenderNodeWrapper,
  useEditorRef,
} from "platejs/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import { cn } from "@repo/ui/lib/utils";

const BlockDraggable: RenderNodeWrapper = ({ editor, path }) => {
  if (editor.dom.readOnly) return undefined;
  // Top-level blocks only — nested list/quote children drag with their parent.
  if (path.length !== 1) return undefined;
  return (props) => <Draggable {...props} />;
};

function Draggable(props: PlateElementProps) {
  const { children, element } = props;
  const editor = useEditorRef();
  const { isDragging, handleRef, nodeRef } = useDraggable({ element });

  const insertBelow = () => {
    const at = editor.api.findPath(element);
    const target = at ? PathApi.next(at.slice(0, 1)) : undefined;
    editor.tf.insertNodes(
      editor.api.create.block(),
      target ? { at: target, select: true } : { select: true },
    );
    editor.tf.insertText("/");
  };

  return (
    <div className={cn("group/block relative", isDragging && "opacity-50")}>
      <div
        contentEditable={false}
        className="absolute top-0 -left-11 z-40 flex h-[1.5em] items-center gap-0.5 opacity-0 transition-opacity group-hover/block:opacity-100"
      >
        <button
          type="button"
          tabIndex={-1}
          onClick={insertBelow}
          title="Add block below"
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground"
        >
          <PlusIcon className="size-4" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          ref={handleRef}
          title="Drag to move"
          className="flex size-5 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-4" />
        </button>
      </div>

      <div ref={nodeRef} className="flow-root">
        <MemoizedChildren>{children}</MemoizedChildren>
        <DropLine />
      </div>
    </div>
  );
}

function DropLine() {
  const { dropLine } = useDropLine();
  if (!dropLine) return null;
  return (
    <div
      className={cn(
        "absolute inset-x-0 z-40 h-0.5 bg-primary/60",
        dropLine === "top" ? "-top-px" : "-bottom-px",
      )}
    />
  );
}

export const DndKit = [
  DndPlugin.configure({
    render: {
      aboveNodes: BlockDraggable,
      aboveSlate: ({ children }) => <DndProvider backend={HTML5Backend}>{children}</DndProvider>,
    },
  }),
];
