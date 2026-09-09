// plugin order is load-bearing: frontmatter first so `---` is claimed before thematic-break;
// math before gfm/mdx; opaque last, over the finished tree and the complete set of stringify
// extensions.

import type { ListItem, Nodes, ThematicBreak } from "mdast";
import type { Handle, Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Plugin } from "unified";
import { gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item";
import { defaultHandlers } from "mdast-util-to-markdown";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { remarkMdxAgnostic } from "./remark-mdx-agnostic";
import { remarkOpaque } from "./remark-opaque";
import { remarkInlineConstructs } from "./remark-inline-constructs";
import { remarkTabs } from "./remark-tabs";
import { remarkWikiLink } from "./remark-wiki-link";

// a thematic break at byte 0 would emit `---`, which the next parse claims as a frontmatter
// fence; doc-leading hrs emit `***`.
const thematicBreakNeverFrontmatter: Handle = (node: ThematicBreak, parent, state) => {
  if (parent?.type === "root" && parent.children[0] === node) {
    return "***";
  }
  return defaultHandlers.thematicBreak(node, parent, state);
};

// options.handlers replace extension handlers wholesale, so the wrapper delegates to gfm's own.
const gfmListItem = gfmTaskListItemToMarkdown().handlers?.listItem;
if (!gfmListItem) {
  throw new Error(
    "mdast-util-gfm-task-list-item ships no listItem handler — pipeline cannot start",
  );
}

// gfm emits an empty todo as a bare `-` (the checkbox follows the bullet's space, which empty
// content never produces), so a just-created todo lost its checkbox on first save. the zwsp
// placeholder re-parses as an empty todo; micromark needs non-whitespace after `[ ]`.
const listItemEmptyTodoPlaceholder: Handle = (node: Nodes, parent, state, info) => {
  if (node.type === "listItem" && node.checked !== null && node.checked !== undefined) {
    const [head] = node.children;
    const headEmpty =
      head?.type === "paragraph" &&
      head.children.every((child) => child.type === "text" && child.value === "");
    if (headEmpty) {
      const placeholder: ListItem = {
        ...node,
        children: [
          { ...head, children: [{ type: "text", value: "\u200B" }] },
          ...node.children.slice(1),
        ],
      };
      return gfmListItem(placeholder, parent, state, info);
    }
  }
  return gfmListItem(node, parent, state, info);
};

// `-` bullets match Obsidian (remark's default is `*`). `resourceLink: true` bans the `<url>`
// autolink form: under MDX a serialized `<mailto:…>` re-parses as broken JSX.
export const MD_STRINGIFY = {
  bullet: "-",
  handlers: {
    listItem: listItemEmptyTodoPlaceholder,
    thematicBreak: thematicBreakNeverFrontmatter,
  },
  listItemIndent: "one",
  resourceLink: true,
  rule: "-",
} satisfies ToMarkdownOptions;

// single-dollar math is off: "$5 and $6" must never render as math. Plate types remarkPlugins
// as Plugin[] (no [plugin, options] tuples), so options are bound via named wrappers.
const remarkMathNoSingleDollar: Plugin = function remarkMathNoSingleDollar() {
  remarkMath.call(this, { singleDollarTextMath: false });
};

const remarkOpaqueCanonical: Plugin = function remarkOpaqueCanonical() {
  return remarkOpaque.call(this, MD_STRINGIFY);
};

export const MD_REMARK_PLUGINS: Plugin[] = [
  // the ['yaml'] default must pair with md-rules' yaml/frontmatter rules
  remarkFrontmatter,
  remarkMathNoSingleDollar,
  remarkGfm,
  // not Plate's remarkMdx (acorn)
  remarkMdxAgnostic,
  remarkWikiLink,
  remarkInlineConstructs,
  remarkTabs,
  remarkOpaqueCanonical,
];
