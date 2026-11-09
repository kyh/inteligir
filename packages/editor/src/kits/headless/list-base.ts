import { KEYS } from "platejs";
import { BaseIndentPlugin } from "@platejs/indent";
import { BaseListPlugin } from "@platejs/list";

import { LIST_MAX_INDENT } from "@repo/contract/library/library-nodes";

// toggle is indentable so list/indent props survive on blocks nested inside a toggle body.
export const INDENTABLE = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock, KEYS.toggle];

// a Tab past what a block stores would leave one no write can save
export const INDENT_OPTIONS = { indentMax: LIST_MAX_INDENT, offset: 24 };

export const ListBaseKit = [
  BaseIndentPlugin.configure({ inject: { targetPlugins: INDENTABLE }, options: INDENT_OPTIONS }),
  BaseListPlugin.configure({ inject: { targetPlugins: INDENTABLE } }),
];
