// Both halves are void so no keystroke can produce a half-valid tag and the bytes leave as
// they arrived; the inline half is inline so a mid-sentence `<!-- -->` does not split the paragraph.

import { createSlatePlugin } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";

import { stringProp } from "@repo/editor/node-props";

const opaqueBlockBasePlugin = createSlatePlugin({
  key: "opaqueBlock",
  node: { isElement: true, isVoid: true },
});

const opaqueInlineBasePlugin = createSlatePlugin({
  key: "opaqueInline",
  node: { isElement: true, isInline: true, isVoid: true },
});

export const OpaqueBaseKit = [opaqueBlockBasePlugin, opaqueInlineBasePlugin];

function OpaqueBlockElement(props: PlateElementProps) {
  return (
    <PlateElement {...props}>
      <pre
        contentEditable={false}
        title="Not editable here — preserved byte-for-byte"
        className="overflow-x-auto rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-2 font-mono text-muted-foreground text-sm whitespace-pre select-none"
      >
        {stringProp(props.element, "value") ?? ""}
      </pre>
      {props.children}
    </PlateElement>
  );
}

function OpaqueInlineElement(props: PlateElementProps) {
  return (
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
}

export const OpaqueKit = [
  opaqueBlockBasePlugin.withComponent(OpaqueBlockElement),
  opaqueInlineBasePlugin.withComponent(OpaqueInlineElement),
];
