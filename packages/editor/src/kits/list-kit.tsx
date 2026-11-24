import { KEYS } from "platejs";
import { IndentPlugin } from "@platejs/indent/react";
import { BulletedListRules, OrderedListRules, TaskListRules } from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";

import { BlockList } from "@repo/editor/block-list";

import { INDENTABLE, INDENT_OPTIONS, LISTABLE } from "@repo/editor/headless/kits/list-base";

const BULLET_STYLES: ReadonlySet<string> = new Set(["circle", "disc", "none", "square"]);

const storedListStyle = (style: string) => {
  if (style === "") {
    return;
  }

  return BULLET_STYLES.has(style) ? "disc" : "decimal";
};

export const ListKit = [
  IndentPlugin.configure({ inject: { targetPlugins: INDENTABLE }, options: INDENT_OPTIONS }),
  ListPlugin.configure({
    inject: { targetPlugins: LISTABLE },
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
