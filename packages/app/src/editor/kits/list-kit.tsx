// List kit — Base half (WP1). Lists are modeled as indented blocks (not a
// dedicated node): the indent + list plugins inject listStyleType/indent props
// into the INDENTABLE block types. WP2 appends the React half (BlockList
// render for markers + todo checkboxes).

import { KEYS } from "platejs";
import { BaseIndentPlugin } from "@platejs/indent";
import { BaseListPlugin } from "@platejs/list";

// Block types lists/indentation attach to. `toggle` is included because toggle
// children are indent-based (potion's ToggleKit spreads the indent targets).
export const INDENTABLE = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock, KEYS.toggle];

export const ListBaseKit = [
  BaseIndentPlugin.configure({ inject: { targetPlugins: INDENTABLE }, options: { offset: 24 } }),
  BaseListPlugin.configure({ inject: { targetPlugins: INDENTABLE } }),
];
