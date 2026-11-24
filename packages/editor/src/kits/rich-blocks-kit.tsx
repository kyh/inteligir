import { CanvasElement } from "@repo/editor/nodes/canvas-node";
import { ChartElement } from "@repo/editor/nodes/chart-node";
import { HtmlElement } from "@repo/editor/nodes/html-node";

import {
  canvasBasePlugin,
  chartBasePlugin,
  htmlBasePlugin,
} from "@repo/editor/headless/kits/rich-blocks-base";

export const RichBlocksKit = [
  chartBasePlugin.withComponent(ChartElement),
  canvasBasePlugin.withComponent(CanvasElement),
  htmlBasePlugin.withComponent(HtmlElement),
];
