import { createSlatePlugin } from "platejs";

import { CANVAS_BLOCK_KEY, CHART_BLOCK_KEY, HTML_BLOCK_KEY } from "@repo/editor/dialect-node-keys";

export const chartBasePlugin = createSlatePlugin({
  key: CHART_BLOCK_KEY,
  node: { isElement: true, isVoid: true },
});

export const canvasBasePlugin = createSlatePlugin({
  key: CANVAS_BLOCK_KEY,
  node: { isElement: true, isVoid: true },
});

export const htmlBasePlugin = createSlatePlugin({
  key: HTML_BLOCK_KEY,
  node: { isElement: true, isVoid: true },
});

export const RichBlocksBaseKit = [chartBasePlugin, canvasBasePlugin, htmlBasePlugin];
