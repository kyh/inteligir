// The one grammar: CommonMark and GFM as Plate writes them, `$$` math, and remark-directive for the
// dialect's own blocks and inlines. Frontmatter comes first, so a leading `---` is claimed before
// the thematic break reads it.

/// <reference types="remark-parse" />

import type {
  Definition,
  InlineCode,
  ListItem,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Text,
} from "mdast";
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Token,
} from "mdast-util-from-markdown";
import type { InlineMath } from "mdast-util-math";
import { defaultHandlers } from "mdast-util-to-markdown";
import type { Handle, Options as ToMarkdownOptions, Unsafe } from "mdast-util-to-markdown";
import type { Plugin, Processor, Transformer } from "unified";
import { gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item";
import { mathFromMarkdown, mathToMarkdown } from "mdast-util-math";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CONTINUE, SKIP, visit } from "unist-util-visit";

import { z } from "zod";

import { ISO_DATE_PATTERN } from "@repo/contract/iso-date";
import { nestInLists } from "@repo/editor/markdown/md-rules";

import { isMdastRoot } from "./mdast-nodes";

// the directives the dialect reads; any other is the text it was written as
const CONTAINER_DIRECTIVES = new Set(["article", "column", "columns", "tab", "tabs", "toggle"]);
const TEXT_DIRECTIVES = ["date", "formula"] as const;

const ISO_DATE_RE = new RegExp(`^${ISO_DATE_PATTERN}$`, "u");

type TextDirective = Extract<PhrasingContent, { type: "textDirective" }>;
type ContainerDirective = Extract<RootContent, { type: "containerDirective" }>;

const labelText = (node: { children: readonly PhrasingContent[] }): string =>
  node.children.map((child) => ("value" in child ? child.value : "")).join("");

// a text directive the rules can read whole: a date's label is its ISO day, a formula names its
// source
const readableText = (node: TextDirective): boolean => {
  const attributes = node.attributes ?? {};
  switch (node.name) {
    case "date": {
      return Object.keys(attributes).length === 0 && ISO_DATE_RE.test(labelText(node));
    }
    case "formula": {
      return z.string().safeParse(attributes.source).success;
    }
    default: {
      return false;
    }
  }
};

const sourceOf = (node: Nodes, source: string): string | null => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : source.slice(start, end);
};

const textNode = (value: string): Text => ({ type: "text", value });

const paragraphOf = (value: string): Paragraph => ({
  children: [textNode(value)],
  type: "paragraph",
});

const CLOSING_FENCE = /(?<fence>:{3,})[\t ]*$/u;

// an unknown container keeps its marker lines as paragraphs around what it held
const containerAsText = (node: ContainerDirective, source: string): RootContent[] => {
  const written = sourceOf(node, source) ?? `:::${node.name}`;
  const lines = written.split("\n");
  const [first] = lines;
  const last = lines.length > 1 ? lines.at(-1) : undefined;
  const fence = last === undefined ? undefined : CLOSING_FENCE.exec(last)?.groups?.fence;
  const [head] = node.children;
  const body =
    head?.type === "paragraph" && head.data?.directiveLabel === true
      ? node.children.slice(1)
      : node.children;
  return [paragraphOf(first ?? ""), ...body, ...(fence === undefined ? [] : [paragraphOf(fence)])];
};

// Every directive the dialect does not read lands as the text it was written as: an unknown name,
// a leaf, a date that is no day. The source is the file's own bytes, so nothing typed is lost.
const restoreUnknownDirectives = (tree: Root, source: string): void => {
  visit(tree, (node, index, parent) => {
    if (parent === undefined || index === undefined) {
      return;
    }
    if (node.type === "textDirective" && !readableText(node)) {
      parent.children.splice(index, 1, textNode(sourceOf(node, source) ?? `:${node.name}`));
      return [SKIP, index + 1];
    }
    if (node.type === "leafDirective") {
      parent.children.splice(index, 1, paragraphOf(sourceOf(node, source) ?? `::${node.name}`));
      return [SKIP, index + 1];
    }
    if (node.type === "containerDirective" && !CONTAINER_DIRECTIVES.has(node.name)) {
      parent.children.splice(index, 1, ...containerAsText(node, source));
      return index;
    }
    return CONTINUE;
  });
};

// mdast-util-directive escapes a `:` before any word character, so `10:30` would save as `10\:30`.
// Only a name the dialect reads can turn typed text into a node, so only that name is escaped; any
// other directive reads back as its text (`restoreUnknownDirectives`).
const isStockColonEntry = (entry: Unsafe): boolean =>
  entry.character === ":" && entry.before === "[^:]" && entry.atBreak !== true;

const DIALECT_COLON: Unsafe = {
  after: `(?:${TEXT_DIRECTIVES.join("|")})[\\[{]`,
  before: "[^:]",
  character: ":",
  inConstruct: ["phrasing"],
};

// gfm splits a row at every bare pipe, before any inline is read, and an attribute's value has no
// backslash escape, so a pipe in one is written as the character reference the value decodes
const inCellPipes =
  (handle: Handle): Handle =>
  (node, parent, state, info) => {
    const written = handle(node, parent, state, info);
    return state.stack.includes("tableCell")
      ? written.replaceAll(/(?<!\\)\|/gu, "&#x7C;")
      : written;
  };

const remarkDialectDirectives: Plugin = function remarkDialectDirectives(
  this: Processor,
): Transformer {
  remarkDirective.call(this);
  const writer = this.data().toMarkdownExtensions?.at(-1);
  if (writer !== undefined) {
    writer.unsafe = [
      ...(writer.unsafe ?? []).filter((entry) => !isStockColonEntry(entry)),
      DIALECT_COLON,
    ];
    const textDirective = writer.handlers?.textDirective;
    if (textDirective !== undefined) {
      writer.handlers = { ...writer.handlers, textDirective: inCellPipes(textDirective) };
    }
  }
  return (tree, file) => {
    if (isMdastRoot(tree)) {
      restoreUnknownDirectives(tree, String(file));
    }
  };
};

const MATH_OPTIONS = { singleDollarTextMath: false };

const inlineMathHandle = mathToMarkdown(MATH_OPTIONS).handlers?.inlineMath;
const exitInlineMath = mathFromMarkdown().exit?.mathText;
if (!inlineMathHandle || !exitInlineMath) {
  throw new Error("mdast-util-math ships no inline math handlers");
}

// a cell's pipe is gfm's divider, so inline math in a row writes its own as `\|`, read back as gfm
// reads a code span's; TeX's own `\|` is the same double bar as `\Vert`
const CELL_PIPE_SPELLING: ReadonlyMap<string, string> = new Map([
  ["|", String.raw`\|`],
  [String.raw`\|`, String.raw`\Vert `],
]);

const escapeCellPipes = (raw: string): string =>
  raw.replaceAll(/\\[\s\S]|\|/gu, (run) => CELL_PIPE_SPELLING.get(run) ?? run);

const readCellPipes = (raw: string): string =>
  raw.replaceAll(/\\[\\|]/gu, (run) => (run === String.raw`\|` ? "|" : run));

const inlineMathInRow: Handle = (node: InlineMath, parent, state, info) =>
  inlineMathHandle(
    state.stack.includes("tableCell") ? { ...node, value: escapeCellPipes(node.value) } : node,
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

// gfm pairs a cell's backslashes before it splits the row, and a code span reads the last of an odd
// run with its pipe as a bare pipe, so a pipe written after an even run would end the cell. Each
// pipe gets an odd run that reads back as its own; an odd run of the span's own has no spelling,
// so it reads back one backslash longer, and from there holds.
const inlineCodeInRow: Handle = (node: InlineCode, parent, state) => {
  const written = defaultHandlers.inlineCode(node, parent, state);
  return state.stack.includes("tableCell")
    ? written.replaceAll(
        /(?<run>\\*)\|/gu,
        (_pipe, run: string) => `${run}${run.length % 2 === 0 ? "" : "\\"}\\|`,
      )
    : written;
};

// Plate types remarkPlugins as Plugin[] (no [plugin, options] tuples), so options bind by name
const remarkMathNoSingleDollar: Plugin = function remarkMathNoSingleDollar(this: Processor) {
  remarkMath.call(this, MATH_OPTIONS);
  (this.data().fromMarkdownExtensions ??= []).push(inlineMathFromRow);
};

const gfmListItem = gfmTaskListItemToMarkdown().handlers?.listItem;
if (!gfmListItem) {
  throw new Error("mdast-util-gfm-task-list-item ships no listItem handler");
}

// gfm writes an empty to-do as a bare `-`, since its box follows content the item does not have;
// a zero-width space is that content, which Plate's paragraph rule reads back as empty
const listItemEmptyTodo: Handle = (node: ListItem, parent, state, info) => {
  const [head, ...rest] = node.children;
  const empty =
    (node.checked === true || node.checked === false) &&
    head?.type === "paragraph" &&
    head.children.every((child) => child.type === "text" && child.value === "");
  return gfmListItem(
    empty ? { ...node, children: [{ ...head, children: [textNode("​")] }, ...rest] } : node,
    parent,
    state,
    info,
  );
};

// a block nested in a list item rides beside the list until the root is written
const rootInLists: Handle = (node: Root, _parent, state, info) =>
  state.containerFlow({ ...node, children: nestInLists(node.children) }, info);

// `***` for a rule, since a `---` opening the text is frontmatter to the next read
export const MD_STRINGIFY = {
  bullet: "-",
  handlers: {
    inlineCode: inlineCodeInRow,
    inlineMath: inlineMathInRow,
    listItem: listItemEmptyTodo,
    root: rootInLists,
  },
  rule: "*",
} satisfies ToMarkdownOptions;

const imageSource = (alt: string | null | undefined): Text => textNode(`![${alt ?? ""}]()`);

const addressOf = (node: Nodes, urls: ReadonlyMap<string, string>): string | undefined => {
  switch (node.type) {
    case "link":
    case "image": {
      return node.url;
    }
    case "linkReference":
    case "imageReference": {
      return urls.get(node.identifier);
    }
    default: {
      return undefined;
    }
  }
};

// A link or an image to no address names nothing an item can store: a link is its words and an
// image the text that spelled it, whether it wrote its address or a definition did.
const addresslessAsText = (tree: Root): void => {
  const urls = new Map<string, string>();
  visit(tree, (node) => {
    if (node.type === "definition" && !urls.has(node.identifier)) {
      urls.set(node.identifier, node.url);
    }
  });
  visit(tree, (node, index, parent) => {
    if (parent === undefined || index === undefined) {
      return CONTINUE;
    }
    if (addressOf(node, urls) !== "") {
      return CONTINUE;
    }
    if (node.type === "link" || node.type === "linkReference") {
      parent.children.splice(index, 1, ...node.children);
      return index;
    }
    if (node.type === "image" || node.type === "imageReference") {
      parent.children.splice(index, 1, imageSource(node.alt));
      return [SKIP, index + 1];
    }
    return CONTINUE;
  });
};

const definitionLine = (node: Definition): string => {
  const url = node.url === "" ? "<>" : node.url;
  const title = node.title === null || node.title === undefined ? "" : ` "${node.title}"`;
  return `[${node.label ?? node.identifier}]: ${url}${title}`;
};

// Plate reads a reference as the link its label's first definition names and drops every
// definition. One nothing uses, or a label's second, is the line it was written as, so no words a
// person wrote go; the parse's own transforms then read it as finished text, so a bare url in it is
// the link the next read would make it.
const remarkUnusedDefinitions: Plugin = function remarkUnusedDefinitions(
  this: Processor,
): Transformer {
  const data = this.data();
  return (tree) => {
    if (!isMdastRoot(tree)) {
      return;
    }
    addresslessAsText(tree);
    const used = new Set<string>();
    visit(tree, (node) => {
      if (node.type === "linkReference" || node.type === "imageReference") {
        used.add(node.identifier);
      }
    });
    const named = new Set<string>();
    const lines: Paragraph[] = [];
    visit(tree, (node, index, parent) => {
      if (node.type !== "definition" || parent === undefined || index === undefined) {
        return CONTINUE;
      }
      if (used.has(node.identifier) && !named.has(node.identifier)) {
        named.add(node.identifier);
        return CONTINUE;
      }
      const line = paragraphOf(definitionLine(node));
      lines.push(line);
      parent.children.splice(index, 1, line);
      return [SKIP, index + 1];
    });
    const finished: Root = { children: lines, type: "root" };
    for (const extension of (data.fromMarkdownExtensions ?? []).flat()) {
      for (const transform of extension.transforms ?? []) {
        transform(finished);
      }
    }
  };
};

export const MD_REMARK_PLUGINS: Plugin[] = [
  remarkFrontmatter,
  remarkMathNoSingleDollar,
  remarkGfm,
  remarkUnusedDefinitions,
  remarkDialectDirectives,
];
