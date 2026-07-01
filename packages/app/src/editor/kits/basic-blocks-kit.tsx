// Basic blocks kit — Base half (WP1). WP2 appends the React half with the
// heading/paragraph/blockquote/hr components from markdown-editor.tsx.

import {
  BaseBlockquotePlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseHorizontalRulePlugin,
} from "@platejs/basic-nodes";

export const BasicBlocksBaseKit = [
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseBlockquotePlugin,
  BaseHorizontalRulePlugin,
];
