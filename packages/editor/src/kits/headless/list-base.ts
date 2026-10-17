import { KEYS } from "platejs";
import { BaseIndentPlugin } from "@platejs/indent";
import { BaseListPlugin } from "@platejs/list";

// toggle is indentable so list/indent props survive on blocks nested inside a toggle body.
export const INDENTABLE = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock, KEYS.toggle];

export const ListBaseKit = [
  BaseIndentPlugin.configure({ inject: { targetPlugins: INDENTABLE }, options: { offset: 24 } }),
  BaseListPlugin.configure({ inject: { targetPlugins: INDENTABLE } }),
];
