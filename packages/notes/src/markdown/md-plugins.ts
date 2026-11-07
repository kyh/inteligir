// plugin order is load-bearing: frontmatter first so `---` is claimed before thematic-break;
// math before gfm; opaque last, over the finished tree and the complete set of stringify
// extensions.

import type { Break, InlineCode, ListItem, Nodes, ThematicBreak } from "mdast";
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Token,
} from "mdast-util-from-markdown";
import type { InlineMath } from "mdast-util-math";
import type { Handle, Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Plugin, Processor } from "unified";
import { gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item";
import { mathFromMarkdown, mathToMarkdown } from "mdast-util-math";
import { defaultHandlers } from "mdast-util-to-markdown";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { escapeCellPipes, readCellPipes } from "./line-scan";
import { remarkContainers } from "./remark-containers";
import { remarkInlineConstructs } from "./remark-inline-constructs";
import { remarkInlineHtml } from "./remark-inline-html";
import { remarkObsidian } from "./remark-obsidian";
import { remarkOpaque } from "./remark-opaque";
import { remarkReferences } from "./remark-references";
import { remarkWikiLink } from "./remark-wiki-link";
import { remarkTextEscapes } from "./text-escapes";

// a thematic break at byte 0 would emit `---`, which the next parse claims as a frontmatter
// fence; doc-leading hrs emit `***`.
const thematicBreakNeverFrontmatter: Handle = (node: ThematicBreak, parent, state) => {
  if (parent?.type === "root" && parent.children[0] === node) {
    return "***";
  }
  return defaultHandlers.thematicBreak(node, parent, state);
};

// a bare url runs to the next whitespace, so a hard break spelled `\` after one reads back as the
// url's last character and the url grows a `\` on every save; two trailing spaces are the same
// break. an emphasis mark closing after the url does not end it either.
const BARE_URL_TAIL = /(?:https?:\/\/|www\.)\S*$/iu;

const endsWithBareUrl = (node: Nodes): boolean => {
  switch (node.type) {
    case "text":
    case "html":
    case "opaqueInline": {
      return BARE_URL_TAIL.test(node.value);
    }
    case "delete":
    case "emphasis":
    case "strong": {
      const last = node.children.at(-1);
      return last !== undefined && endsWithBareUrl(last);
    }
    default: {
      return false;
    }
  }
};

const hardBreakAfterBareUrl: Handle = (node: Break, parent, state, info) => {
  const spelled = defaultHandlers.break(node, parent, state, info);
  const siblings: readonly Nodes[] = parent?.children ?? [];
  const before = siblings[siblings.indexOf(node) - 1];
  return spelled === "\\\n" && before !== undefined && endsWithBareUrl(before) ? "  \n" : spelled;
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

const MATH_OPTIONS = { singleDollarTextMath: false };

const inlineMathHandle = mathToMarkdown(MATH_OPTIONS).handlers?.inlineMath;
const exitInlineMath = mathFromMarkdown().exit?.mathText;
if (!inlineMathHandle || !exitInlineMath) {
  throw new Error("mdast-util-math ships no inline math handlers — pipeline cannot start");
}

// gfm has no word for inline math, whose pipes would end the cell. TeX's own `\|` reads back as a
// pipe here, so it goes as the same bar by its other name.
const inlineMathInRow: Handle = (node: InlineMath, parent, state, info) =>
  inlineMathHandle(
    state.stack.includes("tableCell")
      ? { ...node, value: escapeCellPipes(node.value, String.raw`\Vert `) }
      : node,
    parent,
    state,
    info,
  );

const inlineMathFromRow: FromMarkdownExtension = {
  exit: {
    mathText(this: CompileContext, token: Token) {
      exitInlineMath.call(this, token);
      const parent = this.stack.at(-1);
      const math = parent !== undefined && "children" in parent ? parent.children.at(-1) : null;
      if (this.data.inTable === true && math?.type === "inlineMath") {
        math.value = readCellPipes(math.value);
      }
    },
  },
};

// gfm's own handler escapes a pipe a backslash stands before into `\\|`, a divider. No spelling keeps
// that one backslash in a cell, so it gains a second, and the row stands.
const inlineCodeInRow: Handle = (node: InlineCode, parent, state) => {
  const written = defaultHandlers.inlineCode(node, parent, state);
  return state.stack.includes("tableCell") ? escapeCellPipes(written, String.raw`\\\|`) : written;
};

// `-` bullets match Obsidian (remark's default is `*`). `resourceLink: true` bans the `<url>`
// autolink form, so a link has one spelling: its bare literal (md-rules) or `[text](url)`.
export const MD_STRINGIFY = {
  bullet: "-",
  handlers: {
    break: hardBreakAfterBareUrl,
    inlineCode: inlineCodeInRow,
    inlineMath: inlineMathInRow,
    listItem: listItemEmptyTodoPlaceholder,
    thematicBreak: thematicBreakNeverFrontmatter,
  },
  listItemIndent: "one",
  resourceLink: true,
  rule: "-",
} satisfies ToMarkdownOptions;

// single-dollar math is off: "$5 and $6" must never render as math. Plate types remarkPlugins
// as Plugin[] (no [plugin, options] tuples), so options are bound via named wrappers.
const remarkMathNoSingleDollar: Plugin = function remarkMathNoSingleDollar(this: Processor) {
  remarkMath.call(this, MATH_OPTIONS);
  (this.data().fromMarkdownExtensions ??= []).push(inlineMathFromRow);
};

const remarkOpaqueCanonical: Plugin = function remarkOpaqueCanonical() {
  return remarkOpaque.call(this, MD_STRINGIFY);
};

// a 4-space-indented `- [ ]` must read as a task, never as code
const remarkNoIndentedCode: Plugin = function remarkNoIndentedCode(this: Processor): undefined {
  (this.data().micromarkExtensions ??= []).push({ disable: { null: ["codeIndented"] } });
};

export const MD_REMARK_PLUGINS: Plugin[] = [
  // the ['yaml'] default must pair with md-rules' yaml/frontmatter rules
  remarkFrontmatter,
  remarkMathNoSingleDollar,
  remarkGfm,
  remarkNoIndentedCode,
  remarkTextEscapes,
  remarkInlineHtml,
  remarkWikiLink,
  remarkInlineConstructs,
  remarkObsidian,
  remarkContainers,
  remarkReferences,
  remarkOpaqueCanonical,
];

// the one parser over the dialect: ./parse runs its transformers over what it parses, ./bare-parse
// stops at the parse.
export const MD_PROCESSOR = unified().use(remarkParse).use(MD_REMARK_PLUGINS).freeze();
