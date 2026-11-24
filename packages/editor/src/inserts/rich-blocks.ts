import type { SlateEditor } from "platejs";

import {
  CANVAS_BLOCK_KEY,
  CHART_BLOCK_KEY,
  HTML_BLOCK_KEY,
} from "@repo/editor/headless/dialect-node-keys";
import { GRID_HEADER } from "@repo/editor/nodes/canvas-header";

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

const insertRichBlock = (editor: SlateEditor, type: string, value: string) => {
  editor.tf.insertNodes({ children: [{ text: "" }], type, value });
};

export const insertChartBlock = (editor: SlateEditor) => {
  insertRichBlock(editor, CHART_BLOCK_KEY, SEED_CHART);
};

export const insertCanvasBlock = (editor: SlateEditor) => {
  insertRichBlock(editor, CANVAS_BLOCK_KEY, SEED_CANVAS);
};

export const insertHtmlBlock = (editor: SlateEditor) => {
  insertRichBlock(editor, HTML_BLOCK_KEY, SEED_HTML);
};
