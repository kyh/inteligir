import { KEYS } from "platejs";
import { BaseIndentPlugin } from "@platejs/indent";
import { BaseListPlugin } from "@platejs/list";

import { LIST_MAX_INDENT } from "@repo/contract/library/library-nodes";

import {
  CANVAS_BLOCK_KEY,
  CHART_BLOCK_KEY,
  HTML_BLOCK_KEY,
  TAB_GROUP_KEY,
} from "@repo/editor/headless/dialect-node-keys";

export const LISTABLE = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock, KEYS.toggle];

export const INDENTABLE = [
  ...LISTABLE,
  KEYS.table,
  KEYS.columnGroup,
  TAB_GROUP_KEY,
  KEYS.hr,
  KEYS.equation,
  KEYS.img,
  KEYS.file,
  KEYS.video,
  KEYS.mediaEmbed,
  CHART_BLOCK_KEY,
  CANVAS_BLOCK_KEY,
  HTML_BLOCK_KEY,
];

export const INDENT_OPTIONS = { indentMax: LIST_MAX_INDENT, offset: 24 };

export const ListBaseKit = [
  BaseIndentPlugin.configure({ inject: { targetPlugins: INDENTABLE }, options: INDENT_OPTIONS }),
  BaseListPlugin.configure({ inject: { targetPlugins: LISTABLE } }),
];
