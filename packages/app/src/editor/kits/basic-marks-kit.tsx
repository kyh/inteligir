// Basic marks kit — Base half (WP1). WP2 appends the React half:
//   export const BasicMarksKit = [BoldPlugin.withComponent(...), …]
// with the leaf class names relocated from markdown-editor.tsx.

import {
  BaseBoldPlugin,
  BaseCodePlugin,
  BaseItalicPlugin,
  BaseStrikethroughPlugin,
  BaseUnderlinePlugin,
} from "@platejs/basic-nodes";

export const BasicMarksBaseKit = [
  BaseBoldPlugin,
  BaseItalicPlugin,
  BaseUnderlinePlugin,
  BaseStrikethroughPlugin,
  BaseCodePlugin,
];
