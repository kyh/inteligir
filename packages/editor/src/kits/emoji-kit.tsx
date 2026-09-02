// No `data` option: @emoji-mart/data (~430KB) is dynamic-imported by the input element on first `:`.

import { EmojiInputPlugin, EmojiPlugin } from "@platejs/emoji/react";

import { EmojiInputElement } from "@repo/editor/emoji-input";

export const EmojiKit = [EmojiPlugin, EmojiInputPlugin.withComponent(EmojiInputElement)];
