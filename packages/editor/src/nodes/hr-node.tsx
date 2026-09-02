// Void node: the visual <hr> sits in a non-editable sibling so the void's empty text still renders for Slate.

import { PlateElement, type PlateElementProps } from "platejs/react";

export function HrElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="py-2">
      <div contentEditable={false}>
        <hr className="my-0" />
      </div>
      {props.children}
    </PlateElement>
  );
}
