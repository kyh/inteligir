// Block hover gutter + drag-to-reorder, built on @dnd-kit.
//
// Plate ships a DnD plugin (@platejs/dnd) but it's built on react-dnd, whose
// drag-source connectors silently no-op under React 19 (they never set
// draggable="true"), so the handle can't be grabbed. @dnd-kit is React-19
// native (it's what the sidebar uses), so we drive the reorder ourselves: each
// top-level block becomes a sortable item, and on drop we move the Slate node.
// Reordering top-level blocks just reorders markdown lines — round-trip safe.

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

// Stable per-block drag ids. Slate's moveNodes preserves node object identity,
// so a WeakMap keyed by the element yields ids that survive a reorder. Both the
// SortableContext list and each useSortable() re-derive from this map within the
// same render, so they always agree.
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

// Potion-style drop indicator: the document stays STILL during a drag (no
// live sibling displacement) and an explicit line marks where the block
// lands. Non-active items get no transform; the active block still follows
// the pointer (its transform is the drag delta, not the strategy's).
const noDisplacement = () => null;

function DragProvider({ children }: { children: React.ReactNode }) {
  const editor = useEditorRef();
  // 4px activation distance so a plain click on the grip/"+" still works.
  // Keyboard sensor makes the grip a real a11y handle (Space to lift, arrows to
  // move, Space to drop).
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
  // Top-level blocks only — nested list/quote/table children move with parents.
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
  // A drag ends in a synthetic click on the grip; remember a drag happened so
  // that click doesn't pop the menu open right after a reorder.
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

  // Grip click: select this block and open THE block menu (block-menu.tsx —
  // same one as right-click) anchored under the grip.
  const openBlockMenu = () => {
    const id = stringProp(element, "id") ?? null;
    const grip = gripRef.current;
    if (!id || !grip) return;
    editor.getApi(BlockSelectionPlugin).blockSelection.set(id);
    const rect = grip.getBoundingClientRect();
    editor.getApi(BlockMenuPlugin).blockMenu.show(id, { x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <div
      ref={setNodeRef}
      // Transform only the dragged block — siblings stay put (noDisplacement)
      // and would otherwise snap when a stale transform lingered.
      // CSS.Translate (not CSS.Transform): the sortable transform carries a
      // scaleX/scaleY when the drag-over block differs in size (heading vs
      // paragraph), which stretches the dragged block. Translate-only keeps it
      // 1:1 while following the pointer.
      style={isDragging ? { transform: CSS.Translate.toString(transform), transition } : undefined}
      className={cn("group/block relative", isDragging && "z-10 opacity-60")}
    >
      <div
        contentEditable={false}
        // Match the gutter's font-size to the block's first line so the
        // em-based box (h-[1.3em]) + items-center lands the handles on the
        // text center — headings are larger than the 13px body base, so a
        // fixed base-em box floats above them. top-[3px] matches the block
        // content's py-[3px]; the size-5 buttons stay a fixed 20px (rem).
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

      {/* Drop line: where the dragged block lands relative to THIS block —
          below it when dragging down, above it when dragging up. */}
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
    // aboveEditable (not aboveSlate): DragProvider needs the editor context
    // (useEditorRef) to build the sortable id list + handle the drop, and it
    // must still wrap every node so each block's useSortable sees the context.
    render: { aboveNodes: BlockDraggable, aboveEditable: DragProvider },
  }),
];
