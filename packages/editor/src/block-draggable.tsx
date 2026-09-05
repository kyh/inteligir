// Not @platejs/dnd: its react-dnd drag sources never set draggable="true"
// under React 19, so the handle cannot be grabbed.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef } from "react";
import { GripVerticalIcon, PlusIcon } from "lucide-react";
import { BlockMenuPlugin, BlockSelectionPlugin } from "@platejs/selection/react";
import { PathApi, type Descendant } from "platejs";
import {
  createPlatePlugin,
  type PlateElementProps,
  type RenderNodeWrapper,
  useEditorRef,
} from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import { stringProp } from "@repo/editor/node-props";

// Slate's moveNodes preserves node identity, so a WeakMap keyed by element yields ids that survive a reorder.
let idCounter = 0;
const blockIds = new WeakMap<Descendant, string>();
function blockId(node: Descendant): string {
  const existing = blockIds.get(node);
  if (existing) return existing;
  idCounter += 1;
  const id = `blk-${idCounter}`;
  blockIds.set(node, id);
  return id;
}

// no sibling displacement during a drag; a drop line marks the target instead
const noDisplacement = () => null;

function DragProvider({ children }: { children: React.ReactNode }) {
  const editor = useEditorRef();
  // 4px activation so a plain click on the grip still works
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const items = editor.children.map((n) => blockId(n));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = editor.children.map((n) => blockId(n));
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
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
}

const BlockDraggable: RenderNodeWrapper = ({ editor, path }) => {
  if (editor.dom.readOnly) return undefined;
  if (path.length !== 1) return undefined;
  return (props) => <Draggable {...props} />;
};

function Draggable(props: PlateElementProps) {
  const { children, element } = props;
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
  } = useSortable({ id: blockId(element) });

  const gripRef = useRef<HTMLButtonElement | null>(null);
  // a drag ends in a synthetic click on the grip, which must not open the menu
  const draggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) draggedRef.current = true;
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
    const id = stringProp(element, "id") ?? null;
    const grip = gripRef.current;
    if (!id || !grip) return;
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

      {children}

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
}

export const DragKit = [
  createPlatePlugin({
    key: "block-drag",
    // aboveEditable, not aboveSlate: DragProvider needs useEditorRef
    render: { aboveNodes: BlockDraggable, aboveEditable: DragProvider },
  }),
];
