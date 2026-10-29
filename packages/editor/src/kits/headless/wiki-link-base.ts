import { createSlatePlugin } from "platejs";

import { WIKI_EMBED_KEY, WIKI_LINK_KEY } from "@repo/editor/dialect-node-keys";

export const wikiLinkBasePlugin = createSlatePlugin({
  key: WIKI_LINK_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const wikiEmbedBasePlugin = createSlatePlugin({
  key: WIKI_EMBED_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const WikiLinkBaseKit = [wikiLinkBasePlugin, wikiEmbedBasePlugin];
