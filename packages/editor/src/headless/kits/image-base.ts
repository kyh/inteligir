import { KEYS, createSlatePlugin } from "platejs";

const imageBasePlugin = createSlatePlugin({
  key: KEYS.img,
  node: { isElement: true, isVoid: true },
});

export const ImageBaseKit = [imageBasePlugin];
