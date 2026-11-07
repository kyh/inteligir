import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { stringProp } from "@repo/editor/node-props";

import { opaqueBasePlugin } from "./headless/opaque-base";

const OpaqueElement = (props: PlateElementProps) => (
  <PlateElement {...props} as="span">
    <span
      contentEditable={false}
      title="Not editable here — preserved byte-for-byte"
      className="rounded-sm bg-muted/60 px-1 font-mono text-muted-foreground text-[0.9em] whitespace-pre-wrap select-none"
    >
      {stringProp(props.element, "source") ?? ""}
    </span>
    {props.children}
  </PlateElement>
);

export const OpaqueKit = [opaqueBasePlugin.withComponent(OpaqueElement)];
