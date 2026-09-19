// Void node: the visual <hr> sits in a non-editable sibling so the void's empty text still renders for Slate.

import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

export const HrElement = (props: PlateElementProps) => (
  <PlateElement {...props} className="py-2">
    <div contentEditable={false}>
      <hr className="my-0" />
    </div>
    {props.children}
  </PlateElement>
);
