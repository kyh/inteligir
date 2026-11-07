import { KEYS } from "platejs";
import type { SlateEditor } from "platejs";
import { IndentPlugin } from "@platejs/indent/react";
import { BulletedListRules, OrderedListRules, TaskListRules } from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";

import { BlockList } from "@repo/editor/block-list";

import { INDENTABLE } from "./headless/list-base";

// what css spells a bullet with; every other style a pasted list carries is a kind of number
const BULLET_STYLES: ReadonlySet<string> = new Set(["circle", "disc", "none", "square"]);

// a pasted list is styled however its page styled it, and a block stores only a bullet or a number
const storedListStyle = (style: string): string | undefined => {
  if (style === "") {
    return undefined;
  }
  return BULLET_STYLES.has(style) ? "disc" : "decimal";
};

export const ListKit = [
  IndentPlugin.configure({ inject: { targetPlugins: INDENTABLE }, options: { offset: 24 } }),
  ListPlugin.configure({
    inject: { targetPlugins: INDENTABLE },
    // Plate's own parse of an item, but for the style it would keep as written
    parsers: {
      html: {
        deserializer: {
          parse: ({ editor, element }) => ({
            indent:
              Number(element.dataset.indent ?? element.getAttribute("aria-level")) || undefined,
            listStyleType: storedListStyle(element.dataset.listStyleType ?? ""),
            type: editor.getType(KEYS.p),
          }),
        },
      },
    },
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

// what Tab and Shift+Tab run, so a surface with no Tab key indents exactly the blocks the key would
export const indentBlocks = (editor: SlateEditor): void => {
  editor.tf.tab({ reverse: false });
};

export const outdentBlocks = (editor: SlateEditor): void => {
  editor.tf.tab({ reverse: true });
};
