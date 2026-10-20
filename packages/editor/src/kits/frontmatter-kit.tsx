import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { FrontmatterBasePlugin } from "./headless/frontmatter-base";

// Zero-height rather than unmounted: Slate needs the node's DOM point.
const FrontmatterElement = (props: PlateElementProps) => (
  <PlateElement {...props} className="h-0 overflow-hidden select-none">
    {props.children}
  </PlateElement>
);

export const FrontmatterKit = [FrontmatterBasePlugin.withComponent(FrontmatterElement)];
