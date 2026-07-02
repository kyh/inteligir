// Horizontal rule is a void node, so the visual <hr> lives in a non-editable
// sibling and Plate's children (the void's empty text) still render for Slate.
// Relocated verbatim from markdown-editor.tsx in WP2.

import { PlateElement, type PlateElementProps } from "platejs/react";

export function HrElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="mb-1 py-2">
      <div contentEditable={false}>
        <hr className="h-0.5 rounded-sm border-none bg-muted bg-clip-content" />
      </div>
      {props.children}
    </PlateElement>
  );
}
