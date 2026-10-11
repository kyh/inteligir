// Void so no keystroke can produce a half-valid tag and the bytes leave as they arrived; inline so a
// mid-sentence `<!-- -->` does not split the paragraph.

import { createSlatePlugin } from "platejs";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { OPAQUE_INLINE_KEY } from "@repo/editor/dialect-node-keys";
import { stringProp } from "@repo/editor/node-props";

const opaqueInlineBasePlugin = createSlatePlugin({
  key: OPAQUE_INLINE_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const OpaqueBaseKit = [opaqueInlineBasePlugin];

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
