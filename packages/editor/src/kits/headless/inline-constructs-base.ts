import { createSlatePlugin } from "platejs";

import { ANNOTATION_MARKER_KEY, FORMULA_PILL_KEY } from "@repo/editor/dialect-node-keys";

export const formulaPillBasePlugin = createSlatePlugin({
  key: FORMULA_PILL_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const annotationMarkerBasePlugin = createSlatePlugin({
  key: ANNOTATION_MARKER_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const InlineConstructsBaseKit = [formulaPillBasePlugin, annotationMarkerBasePlugin];
