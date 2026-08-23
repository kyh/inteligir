// The remark stack + stringify conventions shared by BOTH pipeline directions
// (parse in parse.ts, serialize via @platejs/markdown's serializeMd) and BOTH
// editors (headless mirror + live editor, through kits/markdown-kit.ts).
//
// Plugin order is load-bearing and pinned by the round-trip fixture matrix:
// frontmatter must precede everything so `---` is claimed before
// thematic-break; math before gfm/mdx; the agnostic MDX and wiki-link
// extensions are ours; the opaque transform runs LAST, over the finished tree
// and the complete set of stringify extensions.

import type { ListItem } from "mdast";
import type { Handle } from "mdast-util-to-markdown";
import type { Plugin, Processor, Transformer } from "unified";
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

// Single-dollar math is OFF (locked decision): "$5 and $6" in meeting notes
// must never render as math. Inline math is `$$x$$` (remark-math still treats
// a double-dollar run in text position as inline math); display math is `$$`
// blocks. Plate's MarkdownPlugin types remarkPlugins as Plugin[] (no
// [plugin, options] tuples), so the option is bound via this named wrapper.
function remarkMathNoSingleDollar(this: Processor): undefined {
  return remarkMath.call(this, { singleDollarTextMath: false });
}

// Plate types remarkPlugins as Plugin[] (no [plugin, options] tuples), so the
// opaque transform's stringify conventions are bound by this named wrapper —
// the same shape remarkMathNoSingleDollar uses above.
function remarkOpaqueCanonical(this: Processor): Transformer | undefined | void {
  return remarkOpaque.call(this, MD_STRINGIFY);
}

export const MD_REMARK_PLUGINS: Plugin[] = [
  remarkFrontmatter, // ['yaml'] default — MUST pair with md-rules' yaml/frontmatter rules
  remarkMathNoSingleDollar,
  remarkGfm,
  remarkMdxAgnostic, // ours — NOT Plate's remarkMdx (acorn)
  remarkWikiLink, // ours — [[target]] / [[target|alias]] / ![[embed]]
  remarkInlineConstructs, // ours — {{formula|display}} pills + %%i:id%% comment anchors
  remarkTabs, // ours — :::tabs / === Label / ::: panel containers
  remarkOpaqueCanonical, // ours — everything the editor cannot model, held verbatim
];

// A thematic break serialized as the FIRST line of a document would emit
// `---` at byte 0 — which the next parse claims as a frontmatter fence,
// silently absorbing following prose into YAML (or failing over to setext
// readings). Doc-leading hrs emit `***`; everywhere else `rule: "-"` applies.
// This is the only serializer that can put `---` at byte 0 for a
// non-frontmatter document: paragraphs escape a leading `-`, and every other
// block starts with its own marker.
const thematicBreakNeverFrontmatter: Handle = (node, parent, state) => {
  if (parent?.type === "root" && parent.children[0] === node) return "***";
  return defaultHandlers.thematicBreak(node, parent, state);
};

// gfm's own task-list-item serializer, hoisted so the wrapper below can
// delegate to it (options.handlers REPLACE extension handlers wholesale).
const gfmListItem = gfmTaskListItemToMarkdown().handlers?.listItem;
if (!gfmListItem) {
  throw new Error(
    "mdast-util-gfm-task-list-item ships no listItem handler — pipeline cannot start",
  );
}

function isListItem(node: unknown): node is ListItem {
  return node !== null && typeof node === "object" && "type" in node && node.type === "listItem";
}

// An EMPTY todo cannot survive gfm's serializer as-is: with no content the
// item emits as a bare `-` (the checkbox is inserted after the bullet's
// following space, which empty content never produces) — so a just-created
// todo silently loses its checkbox on the first save. Give empty checked
// items the same ZWSP placeholder Plate uses for empty paragraphs: `- [ ] ​`
// re-parses as an empty todo (micromark needs non-whitespace after `[ ]` —
// matching GitHub's files behavior, which is also why a hand-WRITTEN bare
// `- [ ]` is literal text per GFM, not a todo, and stays that way here).
const listItemEmptyTodoPlaceholder: Handle = (node, parent, state, info) => {
  if (isListItem(node) && typeof node.checked === "boolean") {
    const head = node.children[0];
    const headEmpty =
      head?.type === "paragraph" &&
      head.children.every((child) => child.type === "text" && child.value === "");
    if (headEmpty) {
      const placeholder: ListItem = {
        ...node,
        children: [{ ...head, children: [{ type: "text", value: "​" }] }, ...node.children.slice(1)],
      };
      return gfmListItem(placeholder, parent, state, info);
    }
  }
  return gfmListItem(node, parent, state, info);
};

// Shared serialize conventions so the editor and the gate agree on what
// "canonical" means. `-` bullets match Obsidian/common markdown (remark's
// default is `*`); `rule: "-"` keeps a hand-written non-leading `---`
// canonical (doc-leading hrs canonicalize to `***`, see the handler above).
// `resourceLink: true` bans mdast-util-to-markdown's `<url>` angle-autolink
// form outright: under MDX a serialized `<mailto:…>`/`<tel:…>` re-parses as
// broken JSX, so any link the rules don't special-case (md-rules' `a` rule
// emits bare https/email literals itself) must stay in `[text](url)` form.
export const MD_STRINGIFY: {
  bullet: "-";
  handlers: { listItem: Handle; thematicBreak: Handle };
  listItemIndent: "one";
  resourceLink: true;
  rule: "-";
} = {
  bullet: "-",
  handlers: {
    listItem: listItemEmptyTodoPlaceholder,
    thematicBreak: thematicBreakNeverFrontmatter,
  },
  listItemIndent: "one",
  resourceLink: true,
  rule: "-",
};
