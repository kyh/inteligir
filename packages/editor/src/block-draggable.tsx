// Not @platejs/dnd: its react-dnd drag sources never set draggable="true"
// under React 19, so the handle cannot be grabbed.

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, UniqueIdentifier } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef } from "react";
import { GripVerticalIcon, PlusIcon } from "lucide-react";
import { BlockMenuPlugin, BlockSelectionPlugin } from "@platejs/selection/react";
import { PathApi } from "platejs";
import type { Descendant } from "platejs";
import { createPlatePlugin, useEditorRef, useEditorSelector } from "platejs/react";
import type { PlateElementProps, RenderNodeWrapper } from "platejs/react";

import { cn } from "@repo/ui/lib/cn";

import { blockId } from "@repo/editor/node-props";

// A block's NodeIdPlugin id survives both an edit and a move; its node object survives only the move.
const sortableIds = (children: readonly Descendant[]): string[] =>
  children.flatMap((node) => {
    const id = blockId(node);
    return id === undefined ? [] : [id];
  });

// A fresh array every change; compared by value, the sortable context moves only when a block
// joins, leaves or moves.
const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const indexOfBlock = (children: readonly Descendant[], id: UniqueIdentifier): number =>
  children.findIndex((node) => blockId(node) === id);

// no sibling displacement during a drag; a drop line marks the target instead
const noDisplacement = () => null;

const DragProvider = ({ children }: { children: React.ReactNode }) => {
  const editor = useEditorRef();
  // 4px activation so a plain click on the grip still works
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const items = useEditorSelector(() => sortableIds(editor.children), [], {
    equalityFn: sameIds,
  });

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const from = indexOfBlock(editor.children, active.id);
    const to = indexOfBlock(editor.children, over.id);
    if (from === -1 || to === -1) {
      return;
    }
    editor.tf.moveNodes({ at: [from], to: [to] });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={items} strategy={noDisplacement}>
        {children}
      </SortableContext>
    </DndContext>
  );
};

const Draggable = ({ id, ...props }: PlateElementProps & { id: string }) => {
  const { element } = props;
  const editor = useEditorRef();
  const {
    activeIndex,
    attributes,
    index,
    isDragging,
    isOver,
    listeners,
    overIndex,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const gripRef = useRef<HTMLButtonElement | null>(null);
  // a drag ends in a synthetic click on the grip, which must not open the menu
  const draggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) {
      draggedRef.current = true;
    }
  }, [isDragging]);

  const insertBelow = () => {
    const at = editor.api.findPath(element);
    const target = at ? PathApi.next(at.slice(0, 1)) : undefined;
    editor.tf.insertNodes(
      editor.api.create.block(),
      target ? { at: target, select: true } : { select: true },
    );
    editor.tf.insertText("/");
  };

  const openBlockMenu = () => {
    const grip = gripRef.current;
    if (grip === null) {
      return;
    }
    editor.getApi(BlockSelectionPlugin).blockSelection.set(id);
    const rect = grip.getBoundingClientRect();
    editor.getApi(BlockMenuPlugin).blockMenu.show(id, { x: rect.left, y: rect.bottom + 4 });
  };

  // The two handles keep a native title, the one exception to the product tooltip: one
  // Tooltip root per block in a long note is a cost nobody measured.
  // CSS.Translate, not CSS.Transform: the sortable transform carries a scale when
  // the drag-over block differs in size, which stretches the dragged block. The
  // gutter's font-size follows the heading so its em-sized box centers on the first line.
  return (
    <div
      ref={setNodeRef}
      style={isDragging ? { transform: CSS.Translate.toString(transform), transition } : undefined}
      className={cn("group/block relative", isDragging && "z-10 opacity-60")}
    >
      <div
        contentEditable={false}
        className={cn(
          "absolute top-[3px] -left-11 z-40 flex h-[1.3em] items-center gap-0.5 opacity-0 transition-opacity group-hover/block:opacity-100",
          element.type === "h1" && "text-[22px]",
          element.type === "h2" && "text-[16px]",
          element.type === "h3" && "text-[15px]",
        )}
      >
        <button
          type="button"
          aria-label="Add block below"
          tabIndex={-1}
          onClick={insertBelow}
          title="Add block below"
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground"
        >
          <PlusIcon className="size-4" />
        </button>
        <button
          type="button"
          ref={(node) => {
            setActivatorNodeRef(node);
            gripRef.current = node;
          }}
          title="Drag to move · click to open menu"
          onClick={() => {
            if (draggedRef.current) {
              draggedRef.current = false;
              return;
            }
            openBlockMenu();
          }}
          className="flex size-5 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-4" />
        </button>
      </div>

      {props.children}

      {isOver && activeIndex !== index && (
        <div
          contentEditable={false}
          className={cn(
            "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-focus-ring/50",
            overIndex > activeIndex ? "-bottom-px" : "-top-px",
          )}
        />
      )}
    </div>
  );
};

// NodeIdPlugin gives every live block an id; only a test editor, where Plate turns the plugin
// off, has blocks without one, and those render without a handle.
const BlockDraggable: RenderNodeWrapper = ({ editor, element, path }) => {
  if (editor.dom.readOnly) {
    return;
  }
  const id = blockId(element);
  if (path.length !== 1 || id === undefined) {
    return;
  }
  return function DraggableWrapper(props) {
    return <Draggable {...props} id={id} />;
  };
};

export const DragKit = [
  createPlatePlugin({
    key: "block-drag",
    // aboveEditable, not aboveSlate: DragProvider needs useEditorRef
    render: { aboveEditable: DragProvider, aboveNodes: BlockDraggable },
  }),
];
