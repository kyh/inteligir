// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.
// Re-paints the model selection while a menu or popover holds DOM focus.

import { useCursorOverlay, type CursorOverlayState } from "@platejs/selection/react";
import { getTableGridAbove } from "@platejs/table";
import { RangeApi, type UnknownObject } from "platejs";
import { useEditorRef } from "platejs/react";

import { cn } from "cn";

function Cursor({
  id,
  caretPosition,
  selection,
  selectionRects,
}: CursorOverlayState<UnknownObject>) {
  const editor = useEditorRef();
  const isCursor = selection ? RangeApi.isCollapsed(selection) : false;

  // multi-cell table selections have their own selection UI
  if (id === "selection" && selection) {
    const cellEntries = getTableGridAbove(editor, { at: selection, format: "cell" });
    if (cellEntries.length > 1) return null;
  }

  return (
    <>
      {selectionRects.map((position) => (
        <div
          key={`${position.left}:${position.top}:${position.width}:${position.height}`}
          className={cn(
            "pointer-events-none absolute z-10",
            id === "selection" && "bg-primary/25",
            id === "selection" && isCursor && "bg-primary",
          )}
          style={position}
        />
      ))}
      {caretPosition && (
        <div className="pointer-events-none absolute z-10 w-0.5" style={caretPosition} />
      )}
    </>
  );
}

export function CursorOverlay() {
  const { cursors } = useCursorOverlay();

  return (
    <>
      {cursors.map((cursor) => (
        <Cursor key={cursor.id} {...cursor} />
      ))}
    </>
  );
}
