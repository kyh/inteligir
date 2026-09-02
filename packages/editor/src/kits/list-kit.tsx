import { KEYS } from "platejs";
import { BaseIndentPlugin } from "@platejs/indent";
import { IndentPlugin } from "@platejs/indent/react";
import { BaseListPlugin, BulletedListRules, OrderedListRules, TaskListRules } from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";

import { BlockList } from "@repo/editor/block-list";

// toggle is indentable so list/indent props survive on blocks nested inside a toggle body.
const INDENTABLE = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock, KEYS.toggle];

export const ListBaseKit = [
  BaseIndentPlugin.configure({ inject: { targetPlugins: INDENTABLE }, options: { offset: 24 } }),
  BaseListPlugin.configure({ inject: { targetPlugins: INDENTABLE } }),
];

export const ListKit = [
  IndentPlugin.configure({ inject: { targetPlugins: INDENTABLE }, options: { offset: 24 } }),
  ListPlugin.configure({
    inject: { targetPlugins: INDENTABLE },
    inputRules: [
      BulletedListRules.markdown(),
      BulletedListRules.markdown({ variant: "*" }),
      OrderedListRules.markdown(),
      OrderedListRules.markdown({ variant: ")" }),
      TaskListRules.markdown(),
      TaskListRules.markdown({ checked: true }),
    ],
    render: { belowNodes: BlockList },
  }),
];
