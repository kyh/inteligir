// Horizontal rule is a void node, so the visual <hr> lives in a non-editable
// sibling and Plate's children (the void's empty text) still render for Slate.
// Relocated verbatim from markdown-editor.tsx in WP2.

import { PlateElement, type PlateElementProps } from "platejs/react";

export function HrElement(props: PlateElementProps) {
  // Rule appearance comes from typeset; my-0 keeps the wrapper (which already
  // carries the typeset flow margin — see the Slate-wrapper rule in
  // styles/globals.css) from double-spacing, py-2 is the click target.
  return (
    <PlateElement {...props} className="py-2">
      <div contentEditable={false}>
        <hr className="my-0" />
      </div>
      {props.children}
    </PlateElement>
  );
}
