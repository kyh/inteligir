import { KEYS, createSlatePlugin } from "platejs";

// The live half is a separate plugin on the same key: DOM paste/drop handlers exist only on React plugins.
const imageBasePlugin = createSlatePlugin({
  key: KEYS.img,
  node: { isElement: true, isVoid: true },
});

export const ImageBaseKit = [imageBasePlugin];
