import { createSlatePlugin } from "platejs";

import { FORMULA_PILL_KEY } from "@repo/editor/dialect-node-keys";

export const formulaPillBasePlugin = createSlatePlugin({
  key: FORMULA_PILL_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const InlineConstructsBaseKit = [formulaPillBasePlugin];
