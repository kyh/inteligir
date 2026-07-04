// Plate models a table as table > tr > (td|th); the rows need a <tbody> wrapper
// for valid HTML (mirrors Potion's table renderer). GFM tables round-trip.
// The non-editable hover affordances add a row at the bottom / column at the
// right (Tab/Shift-Tab cell navigation is handled natively by the table
// plugin). The per-table Base UI menu is independent of WP3's block menu and
// stays. Relocated verbatim from markdown-editor.tsx in WP2.

import { useRef, useState } from "react";
import { EllipsisIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { deleteColumn, deleteRow, insertTableColumn, insertTableRow } from "@platejs/table";
import { PlateElement, useEditorRef, type PlateElementProps } from "platejs/react";

import { Menu, MenuContent, MenuItem, MenuSeparator } from "@repo/ui/components/menu";

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
    <div className="group/table relative my-3 w-fit max-w-full">
      <button
        type="button"
        contentEditable={false}
        ref={menuBtnRef}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMenuOpen(true)}
        title="Table options"
        className="absolute -top-2.5 -left-2.5 z-10 flex size-5 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-0 transition-opacity group-hover/table:opacity-100 hover:bg-accent hover:text-foreground"
      >
        <EllipsisIcon className="size-3.5" />
      </button>
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuContent anchor={menuBtnRef} side="bottom" align="start">
          <MenuItem onClick={() => deleteRow(editor)}>Delete row</MenuItem>
          <MenuItem onClick={() => deleteColumn(editor)}>Delete column</MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={removeTable}
            className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
          >
            <Trash2Icon />
            Delete table
          </MenuItem>
        </MenuContent>
      </Menu>
      <div className="overflow-x-auto">
        <PlateElement {...props} as="table" className="w-auto border-collapse text-sm">
          <tbody>{props.children}</tbody>
        </PlateElement>
      </div>
      <button
        type="button"
        contentEditable={false}
        onClick={addRow}
        title="Add row"
        className="absolute inset-x-0 -bottom-2.5 flex h-2 items-center justify-center rounded-sm bg-muted text-muted-foreground opacity-0 transition-opacity group-hover/table:opacity-100 hover:bg-accent hover:text-foreground"
      >
        <PlusIcon className="size-3" />
      </button>
      <button
        type="button"
        contentEditable={false}
        onClick={addColumn}
        title="Add column"
        className="absolute inset-y-0 -right-2.5 flex w-2 items-center justify-center rounded-sm bg-muted text-muted-foreground opacity-0 transition-opacity group-hover/table:opacity-100 hover:bg-accent hover:text-foreground"
      >
        <PlusIcon className="size-3" />
      </button>
    </div>
  );
}
