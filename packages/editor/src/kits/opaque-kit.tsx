import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { stringProp } from "@repo/editor/node-props";

import { opaqueInlineBasePlugin } from "./headless/opaque-base";

const OpaqueInlineElement = (props: PlateElementProps) => (
  <PlateElement {...props} as="span">
    <span
      contentEditable={false}
      title="Not editable here — preserved byte-for-byte"
      className="rounded-sm bg-muted/60 px-1 font-mono text-muted-foreground text-[0.9em] whitespace-pre-wrap select-none"
    >
      {stringProp(props.element, "value") ?? ""}
    </span>
    {props.children}
  </PlateElement>
);

export const OpaqueKit = [opaqueInlineBasePlugin.withComponent(OpaqueInlineElement)];
