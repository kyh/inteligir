// Plate models a table as table > tr > (td|th); the rows need a <tbody> wrapper
// for valid HTML. GFM tables round-trip.
// The non-editable hover affordances add a row at the bottom / column at the
// right (Tab/Shift-Tab cell navigation is handled natively by the table
// plugin). The per-table Base UI menu is independent of the block menu.

import { useRef, useState } from "react";
import { EllipsisIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { deleteColumn, deleteRow, insertTableColumn, insertTableRow } from "@platejs/table";
import { PlateElement, useEditorRef, type PlateElementProps } from "platejs/react";

import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/components/dropdown-menu";

export function TableElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const { element } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

  // deleteRow/deleteColumn act on the cell holding the cursor; the trigger
  // preventDefaults mousedown so opening the menu doesn't drop that selection.
  const removeTable = () => {
    const at = editor.api.findPath(element);
    if (at) editor.tf.removeNodes({ at });
  };

  const addRow = () => {
    const at = editor.api.findPath(element);
    if (at) insertTableRow(editor, { at });
  };
  const addColumn = () => {
    const at = editor.api.findPath(element);
    if (!at) return;
    const firstRow = element.children[0];
    const cols =
      firstRow && "children" in firstRow && Array.isArray(firstRow.children)
        ? firstRow.children.length
        : 1;
    insertTableColumn(editor, { fromCell: [...at, 0, cols - 1] });
  };

  return (
    // max-w-full + the inner overflow-x-auto: a wide table scrolls inside its
    // own block instead of being clipped by the editable's overflow-x-hidden
    // (the hover affordances stay outside the scroll container).
    <div className="group/table relative w-fit max-w-full">
      <Button
        variant="ghost"
        size="icon-xs"
        contentEditable={false}
        ref={menuBtnRef}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMenuOpen(true)}
        title="Table options"
        className="absolute -top-2.5 -left-2.5 z-10 size-5 rounded-md border-border bg-background text-muted-foreground opacity-0 group-hover/table:opacity-100"
      >
        <EllipsisIcon className="size-3.5" />
      </Button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuContent anchor={menuBtnRef} side="bottom" align="start">
          <DropdownMenuItem onClick={() => deleteRow(editor)}>Delete row</DropdownMenuItem>
          <DropdownMenuItem onClick={() => deleteColumn(editor)}>Delete column</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={removeTable}>
            <Trash2Icon />
            Delete table
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="overflow-x-auto">
        {/* Grid styling comes from the shared .typeset table rules; mt-0
            because the wrapper div already carries the block's flow margin. */}
        <PlateElement {...props} as="table" className="mt-0">
          <tbody>{props.children}</tbody>
        </PlateElement>
      </div>
      {/* The sliver affordances override the stock height/width (h-2 / w-2)
          and keep a solid bg-muted resting fill, so hover only shifts the
          text color — same in dark (hence the dark:hover override). */}
      <Button
        variant="ghost"
        size="xs"
        contentEditable={false}
        onClick={addRow}
        title="Add row"
        className="absolute inset-x-0 -bottom-2.5 h-2 rounded-sm bg-muted px-0 text-muted-foreground opacity-0 group-hover/table:opacity-100 dark:hover:bg-muted"
      >
        <PlusIcon className="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        contentEditable={false}
        onClick={addColumn}
        title="Add column"
        className="absolute inset-y-0 -right-2.5 h-auto w-2 rounded-sm bg-muted px-0 text-muted-foreground opacity-0 group-hover/table:opacity-100 dark:hover:bg-muted"
      >
        <PlusIcon className="size-3" />
      </Button>
    </div>
  );
}
