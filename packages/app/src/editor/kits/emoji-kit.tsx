// Emoji kit (live editor only — inserts plain unicode text, so there is no
// serialization surface and no Base-half mirror entry). The plugin's `data`
// option is deliberately NOT set: @emoji-mart/data (~430KB) stays out of the
// initial chunk and is dynamic-imported by the input element on first `:`.

import { EmojiInputPlugin, EmojiPlugin } from "@platejs/emoji/react";

import { EmojiInputElement } from "@repo/app/editor/emoji-input";

export const EmojiKit = [
  EmojiPlugin,
  EmojiInputPlugin.withComponent(EmojiInputElement),
];
