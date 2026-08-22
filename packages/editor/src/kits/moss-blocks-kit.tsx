// The rich Moss fence blocks (#586): moss_chart / moss_canvas / moss_html,
// each a BLOCK VOID whose `value` holds the fence payload verbatim —
// byte-exactness by construction, with a degraded code view (never data
// loss) when a renderer refuses its payload. md-rules' code_block dispatch
// owns the fence↔node mapping.

import { createSlatePlugin, type SlateEditor } from "platejs";

import { CanvasElement } from "@repo/editor/nodes/canvas-node";
import { ChartElement } from "@repo/editor/nodes/chart-node";
import { HtmlElement } from "@repo/editor/nodes/html-node";

const chartBasePlugin = createSlatePlugin({
  key: "moss_chart",
  node: { isElement: true, isVoid: true },
});

const canvasBasePlugin = createSlatePlugin({
  key: "moss_canvas",
  node: { isElement: true, isVoid: true },
});

const htmlBasePlugin = createSlatePlugin({
  key: "moss_html",
  node: { isElement: true, isVoid: true },
});

export const MossBlocksBaseKit = [chartBasePlugin, canvasBasePlugin, htmlBasePlugin];

export const MossBlocksKit = [
  chartBasePlugin.withComponent(ChartElement),
  canvasBasePlugin.withComponent(CanvasElement),
  htmlBasePlugin.withComponent(HtmlElement),
];

const SEED_CHART =
  '{"type":"bar","title":"Chart","data":[{"label":"A","value":3},{"label":"B","value":5}]}';

const SEED_CANVAS = "[moss:grid:v2]\n....########....\n....#......#....\n....########....";

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

function insertMossBlock(editor: SlateEditor, type: string, value: string): void {
  editor.tf.insertNodes({ children: [{ text: "" }], type, value });
}

/** The slash rows' verbs. */
export function insertChartBlock(editor: SlateEditor): void {
  insertMossBlock(editor, "moss_chart", SEED_CHART);
}

export function insertCanvasBlock(editor: SlateEditor): void {
  insertMossBlock(editor, "moss_canvas", SEED_CANVAS);
}

export function insertHtmlBlock(editor: SlateEditor): void {
  insertMossBlock(editor, "moss_html", SEED_HTML);
}
