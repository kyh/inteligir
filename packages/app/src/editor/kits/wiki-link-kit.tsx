// Wiki-link kit — Base half (WP1): inline-void nodes for [[target]] /
// [[target|alias]] / ![[embed]]. Node shape: { type, body, children:[{text:""}] }
// with `body` verbatim (round-trip contract lives in markdown/remark-wiki-link).
// WP2 appends the chip renderer + the `]]` input rule; resolution/backlinks/
// autocomplete are Phase F.

import { createSlatePlugin } from "platejs";

export const WikiLinkBaseKit = [
  createSlatePlugin({
    key: "wikiLink",
    node: { isElement: true, isInline: true, isVoid: true },
  }),
  createSlatePlugin({
    key: "wikiEmbed",
    node: { isElement: true, isInline: true, isVoid: true },
  }),
];
