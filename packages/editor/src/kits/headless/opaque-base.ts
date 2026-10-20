// Void so no keystroke can produce a half-valid tag and the bytes leave as they arrived; inline so a
// mid-sentence `<!-- -->` does not split the paragraph.

import { createSlatePlugin } from "platejs";

import { OPAQUE_INLINE_KEY } from "@repo/editor/dialect-node-keys";

export const opaqueInlineBasePlugin = createSlatePlugin({
  key: OPAQUE_INLINE_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const OpaqueBaseKit = [opaqueInlineBasePlugin];
