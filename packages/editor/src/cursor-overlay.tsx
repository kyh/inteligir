// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.
// Selection ghost: while a menu or popover holds DOM focus, the editor's
// selection collapses visually — this overlay re-paints the model selection
// rects so the user still sees what a Turn-into / link / AI action targets.
// Ported with block-menu-kit; the AI menu reuses this plumbing.
// Positioning is relative to the editor's `relative` wrapper
// (markdown-editor.tsx).

import { useCursorOverlay, type CursorOverlayState } from "@platejs/selection/react";
import { getTableGridAbove } from "@platejs/table";
import { RangeApi, type UnknownObject } from "platejs";
import { useEditorRef } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

function Cursor({
  id,
  caretPosition,
  selection,
  selectionRects,
}: CursorOverlayState<UnknownObject>) {
  const editor = useEditorRef();
  const isCursor = selection ? RangeApi.isCollapsed(selection) : false;

  // Multi-cell table selections have their own selection UI.
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
