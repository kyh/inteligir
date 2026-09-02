import { createSlatePlugin, type SlateEditor } from "platejs";

import { CanvasElement } from "@repo/editor/nodes/canvas-node";
import { ChartElement } from "@repo/editor/nodes/chart-node";
import { HtmlElement } from "@repo/editor/nodes/html-node";
import { GRID_HEADER } from "@repo/editor/nodes/canvas-header";

const chartBasePlugin = createSlatePlugin({
  key: "chart_block",
  node: { isElement: true, isVoid: true },
});

const canvasBasePlugin = createSlatePlugin({
  key: "canvas_block",
  node: { isElement: true, isVoid: true },
});

const htmlBasePlugin = createSlatePlugin({
  key: "html_block",
  node: { isElement: true, isVoid: true },
});

export const RichBlocksBaseKit = [chartBasePlugin, canvasBasePlugin, htmlBasePlugin];

export const RichBlocksKit = [
  chartBasePlugin.withComponent(ChartElement),
  canvasBasePlugin.withComponent(CanvasElement),
  htmlBasePlugin.withComponent(HtmlElement),
];

const SEED_CHART =
  '{"type":"bar","title":"Chart","data":[{"label":"A","value":3},{"label":"B","value":5}]}';

const SEED_CANVAS = `${GRID_HEADER}\n....########....\n....#......#....\n....########....`;

const SEED_HTML = [
  "<!DOCTYPE html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  "<style>body { margin: 0; padding: 24px; font-family: ui-sans-serif, system-ui; }</style>",
  "</head>",
  "<body>",
  "  <main><!-- interactive artifact --></main>",
  "</body>",
  "</html>",
].join("\n");

function insertRichBlock(editor: SlateEditor, type: string, value: string): void {
  editor.tf.insertNodes({ children: [{ text: "" }], type, value });
}

export function insertChartBlock(editor: SlateEditor): void {
  insertRichBlock(editor, "chart_block", SEED_CHART);
}

export function insertCanvasBlock(editor: SlateEditor): void {
  insertRichBlock(editor, "canvas_block", SEED_CANVAS);
}

export function insertHtmlBlock(editor: SlateEditor): void {
  insertRichBlock(editor, "html_block", SEED_HTML);
}
