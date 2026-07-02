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
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import { CopyIcon, GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { PathApi } from "platejs";
import {
  createPlatePlugin,
  type PlateElementProps,
  type RenderNodeWrapper,
  useEditorRef,
} from "platejs/react";

import { cn } from "@repo/ui/lib/utils";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
} from "@repo/ui/components/menu";

import { TURN_INTO, turnIntoAt } from "./block-transforms";

// Stable per-block drag ids. Slate's moveNodes preserves node object identity,
// so a WeakMap keyed by the element yields ids that survive a reorder. Both the
// SortableContext list and each useSortable() re-derive from this map within the
// same render, so they always agree.
let idCounter = 0;
const blockIds = new WeakMap<object, string>();
function blockId(node: object): string {
  const existing = blockIds.get(node);
  if (existing) return existing;
  idCounter += 1;
  const id = `blk-${idCounter}`;
  blockIds.set(node, id);
  return id;
}

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
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
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
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: blockId(element) });

  const [menuOpen, setMenuOpen] = useState(false);
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

  const removeBlock = () => {
    const at = editor.api.findPath(element);
    if (at) editor.tf.removeNodes({ at });
  };
  const duplicateBlock = () => {
    const at = editor.api.findPath(element);
    if (at) editor.tf.insertNodes(structuredClone(element), { at: PathApi.next(at) });
  };
  const turnInto = (opt: (typeof TURN_INTO)[number]) => {
    const at = editor.api.findPath(element);
    if (at) turnIntoAt(editor, at, opt);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group/block relative", isDragging && "z-10 opacity-60")}
    >
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
            setMenuOpen(true);
          }}
          className="flex size-5 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-4" />
        </button>
      </div>

      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuContent anchor={gripRef} side="right" align="start">
          <MenuItem onClick={duplicateBlock}>
            <CopyIcon />
            Duplicate
          </MenuItem>
          <MenuSeparator />
          <MenuGroup>
            <MenuGroupLabel>Turn into</MenuGroupLabel>
            {TURN_INTO.map((opt) => (
              <MenuItem key={opt.label} onClick={() => turnInto(opt)}>
                {opt.label}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem
            onClick={removeBlock}
            className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
          >
            <Trash2Icon />
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>

      {children}
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
