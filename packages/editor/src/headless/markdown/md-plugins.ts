/// <reference types="remark-parse" />

import type {
  Blockquote,
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
import { ZERO_WIDTH_SPACE } from "platejs";
import type { Plugin, Processor, Transformer } from "unified";
import { gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item";
import { mathFromMarkdown, mathToMarkdown } from "mdast-util-math";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CONTINUE, SKIP, visit } from "unist-util-visit";

import { isIsoDate } from "@repo/contract/iso-date";
import { ALERT_VARIANTS, alertVariantSchema } from "@repo/contract/library/library-nodes";
import type { AlertVariant } from "@repo/contract/library/library-nodes";

import {
  containerDirectiveSchema,
  formulaAttributesSchema,
  textDirectiveSchema,
} from "./directive-names";
import { nestInLists } from "./mdast-lists";
import { isMdastRoot } from "./mdast-nodes";

declare module "mdast" {
  interface BlockquoteData {
    alert?: AlertVariant;
  }
}

type TextDirective = Extract<PhrasingContent, { type: "textDirective" }>;

type ContainerDirective = Extract<RootContent, { type: "containerDirective" }>;

const labelText = (node: { children: readonly PhrasingContent[] }) =>
  node.children.map((child) => ("value" in child ? child.value : "")).join("");

const readableText = (node: TextDirective) => {
  const attributes = node.attributes ?? {};

  const directiveName = textDirectiveSchema.safeParse(node.name).data;

  switch (directiveName) {
    case "date": {
      return Object.keys(attributes).length === 0 && isIsoDate(labelText(node));
    }

    case "formula": {
      return formulaAttributesSchema.safeParse(attributes).success;
    }

    case "highlight": {
      return Object.keys(attributes).length === 0;
    }

    case undefined: {
      return false;
    }

    default: {
      throw new Error(`unexpected ${String(directiveName satisfies never)}`);
    }
  }
};

const sourceOf = (node: Nodes, source: string) => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;

  return start === undefined || end === undefined ? null : source.slice(start, end);
};

const textNode = (value: string) => ({ type: "text", value }) satisfies Text;

const paragraphOf = (value: string) =>
  ({
    children: [textNode(value)],
    type: "paragraph",
  }) satisfies Paragraph;

const CLOSING_FENCE = /(?<fence>:{3,})[\t ]*$/u;

const containerAsText = (node: ContainerDirective, source: string) => {
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

  return [
    paragraphOf(first ?? ""),
    ...body,
    ...(fence === undefined ? [] : [paragraphOf(fence)]),
  ] satisfies RootContent[];
};

const restoreUnknownDirectives = (tree: Root, source: string) => {
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

    if (
      node.type === "containerDirective" &&
      !containerDirectiveSchema.safeParse(node.name).success
    ) {
      parent.children.splice(index, 1, ...containerAsText(node, source));

      return index;
    }

    return CONTINUE;
  });
};

const isStockColonEntry = (entry: Unsafe) =>
  entry.character === ":" && entry.before === "[^:]" && entry.atBreak !== true;

const DIALECT_COLON: Unsafe = {
  after: `(?:${textDirectiveSchema.options.join("|")})[\\[{]`,
  before: "[^:]",
  character: ":",
  inConstruct: ["phrasing"],
};

const inCellPipes = (handle: Handle) =>
  ((node, parent, state, info) => {
    const written = handle(node, parent, state, info);

    return state.stack.includes("tableCell")
      ? written.replaceAll(/(?<!\\)\|/gu, "&#x7C;")
      : written;
  }) satisfies Handle;

const remarkDialectDirectives: Plugin = function remarkDialectDirectives(this: Processor) {
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

  return ((tree, file) => {
    if (isMdastRoot(tree)) {
      restoreUnknownDirectives(tree, String(file));
    }
  }) satisfies Transformer;
};

const ALERT_MARKER_RE = new RegExp(
  String.raw`^(?<marker>\[!(?<variant>${ALERT_VARIANTS.join("|")})\])[\t ]*\n?`,
  "iu",
);

const alertMarker = (lead: Text, source: string) => {
  const found = ALERT_MARKER_RE.exec(lead.value);
  const alert = alertVariantSchema.safeParse(found?.groups?.variant?.toUpperCase());
  const marker = found?.groups?.marker;
  const at = lead.position?.start.offset;

  if (found === null || !alert.success || marker === undefined || at === undefined) {
    return null;
  }

  return (
    source.startsWith(marker, at) ? { alert: alert.data, length: found[0].length } : null
  ) satisfies { alert: AlertVariant; length: number } | null;
};

const liftAlert = (quote: Blockquote, source: string) => {
  const [first, ...others] = quote.children;
  const [lead, ...rest] = first?.type === "paragraph" ? first.children : [];
  const marker = lead?.type === "text" ? alertMarker(lead, source) : null;

  if (first?.type !== "paragraph" || lead?.type !== "text" || marker === null) {
    return;
  }

  const tail = lead.value.slice(marker.length);
  const [after, ...below] = rest;
  const line = tail === "" && after?.type === "break" ? below : rest;
  const words: PhrasingContent[] = tail === "" ? line : [{ ...lead, value: tail }, ...line];
  quote.data = { ...quote.data, alert: marker.alert };
  quote.children =
    words.length === 0 && others.length > 0 ? others : [{ ...first, children: words }, ...others];
};

const remarkAlerts: Plugin = function remarkAlerts() {
  return ((tree, file) => {
    if (isMdastRoot(tree)) {
      const source = String(file);
      visit(tree, "blockquote", (quote) => {
        liftAlert(quote, source);
      });
    }
  }) satisfies Transformer;
};

const MATH_OPTIONS = { singleDollarTextMath: false };

const inlineMathHandle = mathToMarkdown(MATH_OPTIONS).handlers?.inlineMath;
const exitInlineMath = mathFromMarkdown().exit?.mathText;

if (!inlineMathHandle || !exitInlineMath) {
  throw new Error("mdast-util-math ships no inline math handlers");
}

const CELL_PIPE_SPELLING: ReadonlyMap<string, string> = new Map([
  ["|", String.raw`\|`],
  [String.raw`\|`, String.raw`\Vert `],
]);

const escapeCellPipes = (raw: string) =>
  raw.replaceAll(/\\[\s\S]|\|/gu, (run) => CELL_PIPE_SPELLING.get(run) ?? run);

const readCellPipes = (raw: string) =>
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

const inlineCodeInRow: Handle = (node: InlineCode, parent, state) => {
  const written = defaultHandlers.inlineCode(node, parent, state);

  return state.stack.includes("tableCell")
    ? written.replaceAll(
        /(?<run>\\*)\|/gu,
        (_pipe, run: string) => `${run}${run.length % 2 === 0 ? "" : "\\"}\\|`,
      )
    : written;
};

const remarkMathNoSingleDollar: Plugin = function remarkMathNoSingleDollar(this: Processor) {
  remarkMath.call(this, MATH_OPTIONS);
  (this.data().fromMarkdownExtensions ??= []).push(inlineMathFromRow);
};

const gfmListItem = gfmTaskListItemToMarkdown().handlers?.listItem;

if (!gfmListItem) {
  throw new Error("mdast-util-gfm-task-list-item ships no listItem handler");
}

const listItemEmptyTodo: Handle = (node: ListItem, parent, state, info) => {
  const [head, ...rest] = node.children;

  const empty =
    (node.checked === true || node.checked === false) &&
    head?.type === "paragraph" &&
    head.children.every((child) => child.type === "text" && child.value === "");

  return gfmListItem(
    empty
      ? { ...node, children: [{ ...head, children: [textNode(ZERO_WIDTH_SPACE)] }, ...rest] }
      : node,
    parent,
    state,
    info,
  );
};

const rootInLists: Handle = (node: Root, _parent, state, info) =>
  state.containerFlow({ ...node, children: nestInLists(node.children) }, info);

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

const imageSource = (alt: string | null | undefined) => textNode(`![${alt ?? ""}]()`);

const addressOf = (node: Nodes, urls: ReadonlyMap<string, string>) => {
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
      return null;
    }
  }
};

const addresslessAsText = (tree: Root) => {
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

const definitionLine = (node: Definition) => {
  const url = node.url === "" ? "<>" : node.url;
  const title = node.title === null || node.title === undefined ? "" : ` "${node.title}"`;

  return `[${node.label ?? node.identifier}]: ${url}${title}`;
};

const remarkUnusedDefinitions: Plugin = function remarkUnusedDefinitions(this: Processor) {
  const data = this.data();

  return ((tree) => {
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
  }) satisfies Transformer;
};

export const MD_REMARK_PLUGINS: Plugin[] = [
  remarkFrontmatter,
  remarkMathNoSingleDollar,
  remarkGfm,
  remarkUnusedDefinitions,
  remarkDialectDirectives,
  remarkAlerts,
];
