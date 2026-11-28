import type {
  Blockquote,
  Code,
  Html,
  FootnoteDefinition,
  FootnoteReference,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  RootContent,
  Table,
  TableCell,
  Yaml,
} from "mdast";
import type { Math as MdMath } from "mdast-util-math";
import { ElementApi, KEYS, NodeApi, TextApi, ZERO_WIDTH_SPACE } from "platejs";
import type { Descendant, TElement, TText } from "platejs";
import { convertChildrenDeserialize, convertNodesSerialize, defaultRules } from "@platejs/markdown";
import type {
  DeserializeMdOptions,
  MdDecoration,
  MdRules,
  SerializeMdOptions,
} from "@platejs/markdown";

import { UNTITLED } from "@repo/contract/items/item-name";
import {
  CANVAS_BLOCK_KEY,
  CHART_BLOCK_KEY,
  FORMULA_PILL_KEY,
  HTML_BLOCK_KEY,
  TAB_GROUP_KEY,
  TAB_PANEL_KEY,
} from "@repo/editor/headless/dialect-node-keys";
import { embedTypeForUrl } from "@repo/editor/headless/lib/embed-url";
import {
  CANVAS_LANG,
  CHART_LANG,
  HTML_LANG,
  RICH_FENCE_LANGS,
} from "@repo/editor/headless/fence-langs";
import { alertProp, numberProp, stringProp } from "@repo/editor/headless/node-props";

import {
  containerDirectiveSchema,
  formulaAttributesSchema,
  textDirectiveSchema,
} from "./directive-names";
import type { ContainerDirectiveName, TextDirectiveName } from "./directive-names";
import { isFlow, nestInLists } from "./mdast-lists";
import type { FlowContent } from "./mdast-lists";

type WideMdRule = NonNullable<MdRules[string]>;

type ContainerDirective = Extract<RootContent, { type: "containerDirective" }>;

type TextDirective = Extract<PhrasingContent, { type: "textDirective" }>;

export const ARTICLE_SECTION_KEY = "article_section";

const required = <T>(rule: T | null | undefined, key: string) => {
  if (rule === undefined || rule === null) {
    throw new Error(`@platejs/markdown lost its ${key} rule`);
  }

  return rule;
};

const defaultParagraph = required(defaultRules.p?.deserialize, "p");
const defaultLink = required(defaultRules.a?.deserialize, "a");
const defaultQuote = required(defaultRules.blockquote?.deserialize, "blockquote");
const defaultBlockquote = required(defaultRules.blockquote?.serialize, "blockquote");
const defaultEquation = required(defaultRules.equation?.deserialize, "equation");
const defaultCodeBlock = required(defaultRules.code_block?.deserialize, "code_block");
const defaultList = required(defaultRules.list?.deserialize, "list");
const defaultTable = required(defaultRules.table?.deserialize, "table");
const defaultCell = required(defaultRules.td?.serialize, "td");

const emptyParagraph = () => ({ children: [{ text: "" }], type: KEYS.p }) satisfies TElement;

const blocksOf = (
  children: readonly RootContent[],
  deco: MdDecoration,
  options: DeserializeMdOptions,
) => {
  const blocks: TElement[] = [];

  for (const node of convertChildrenDeserialize([...children], deco, options)) {
    if (ElementApi.isElement(node)) {
      blocks.push(node);
    } else if (TextApi.isText(node) && node.text !== "") {
      blocks.push({ children: [node], type: KEYS.p });
    }
  }

  return (blocks.length > 0 ? blocks : [emptyParagraph()]) satisfies TElement[];
};

const isEmptyParagraph = (node: Descendant | undefined) =>
  node !== undefined &&
  ElementApi.isElement(node) &&
  node.type === KEYS.p &&
  node.children.every((child) => TextApi.isText(child) && child.text === "");

const LIST_NESTED_KEY = "list_nested";

const LIST_DEPTH_KEY = "listDepth";

const isListLine = (block: TElement) => block.type === KEYS.p && "listStyleType" in block;

const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  ARTICLE_SECTION_KEY,
  KEYS.blockquote,
  KEYS.column,
  KEYS.columnGroup,
  KEYS.toggle,
  TAB_GROUP_KEY,
  TAB_PANEL_KEY,
]);

export const writtenInList = (block: TElement) =>
  isListLine(block) || numberProp(block, "indent") !== undefined;

type ListPlace = "outside" | "run" | "nested";

const markedAt = (block: TElement, depth: number) =>
  ({
    children: [block],
    [LIST_DEPTH_KEY]: depth,
    type: LIST_NESTED_KEY,
  }) satisfies TElement;

export const markListNesting = (blocks: readonly Descendant[]) => {
  const marked: Descendant[] = [];
  let place: ListPlace = "outside";

  for (const block of blocks) {
    if (!ElementApi.isElement(block)) {
      marked.push(block);
      place = "outside";
      continue;
    }

    const inner: TElement = CONTAINER_TYPES.has(block.type)
      ? { ...block, children: markListNesting(block.children) }
      : block;

    const indent = numberProp(inner, "indent");

    if (indent === undefined) {
      marked.push(inner);
      place = "outside";
    } else if (isListLine(inner)) {
      marked.push(place === "nested" ? markedAt(inner, indent) : inner);
      place = place === "nested" ? "nested" : "run";
    } else {
      const { indent: _indent, listStyleType: _style, checked: _checked, ...rest } = inner;
      marked.push(markedAt(rest, indent));
      place = place === "outside" ? "outside" : "nested";
    }
  }

  return marked;
};

const isEmptyInlineEquation = (node: Descendant) =>
  ElementApi.isElement(node) &&
  node.type === KEYS.inlineEquation &&
  (stringProp(node, "texExpression") ?? "") === "";

const withoutEmptyEquations: (node: Descendant) => Descendant = (node: Descendant) => {
  if (!ElementApi.isElement(node)) {
    return node;
  }

  const kept = node.children
    .filter((child) => !isEmptyInlineEquation(child))
    .map(withoutEmptyEquations);

  return { ...node, children: kept.length > 0 ? kept : [{ text: "" }] } satisfies Descendant;
};

export const pruneEmptyEquations = (value: readonly Descendant[]) =>
  value.map(withoutEmptyEquations);

const flowOf = (children: readonly Descendant[], options: SerializeMdOptions) => {
  const [only, ...rest] = children;

  if (rest.length === 0 && isEmptyParagraph(only)) {
    return [] satisfies FlowContent[];
  }

  return nestInLists(convertNodesSerialize([...children], options).filter(isFlow));
};

const isLabel = (node: RootContent | undefined): node is Paragraph =>
  node?.type === "paragraph" && node.data?.directiveLabel === true;

const phrasingText: (children: readonly PhrasingContent[]) => string = (
  children: readonly PhrasingContent[],
) =>
  children
    .map((child) => {
      if ("children" in child) {
        return phrasingText(child.children);
      }

      return "value" in child ? child.value : "";
    })
    .join("");

const LABEL_SYNTAX = /[$&*:<[\\\]_`|~]/gu;

const labelPhrasing = (label: string) =>
  (label === ""
    ? []
    : [
        { type: "html", value: label.replaceAll(LABEL_SYNTAX, String.raw`\$&`) },
      ]) satisfies PhrasingContent[];

const labelOf = (node: ContainerDirective) => {
  const [head] = node.children;

  return isLabel(head) ? phrasingText(head.children) : "";
};

const bodyOf = (node: ContainerDirective) =>
  isLabel(node.children[0]) ? node.children.slice(1) : node.children;

const labelParagraph = (label: string) =>
  (label === ""
    ? []
    : [
        {
          children: labelPhrasing(label),
          data: { directiveLabel: true },
          type: "paragraph",
        },
      ]) satisfies Paragraph[];

const container = (
  name: ContainerDirectiveName,
  children: FlowContent[],
  attributes: Record<string, string> = {},
) => ({ attributes, children, name, type: "containerDirective" }) satisfies ContainerDirective;

const WIDTH_RE = /^\d+(?:\.\d+)?%$/u;

const columnOf = (node: ContainerDirective, deco: MdDecoration, options: DeserializeMdOptions) => {
  const column: TElement = { children: blocksOf(bodyOf(node), deco, options), type: KEYS.column };
  const width = node.attributes?.width;

  if (width !== undefined && width !== null && WIDTH_RE.test(width)) {
    column.width = width;
  }

  return column;
};

const panelOf = (node: ContainerDirective, deco: MdDecoration, options: DeserializeMdOptions) =>
  ({
    children: blocksOf(bodyOf(node), deco, options),
    label: labelOf(node),
    type: TAB_PANEL_KEY,
  }) satisfies TElement;

const partsOf = (
  node: ContainerDirective,
  part: ContainerDirectiveName,
  read: (child: ContainerDirective) => TElement,
  deco: MdDecoration,
  options: DeserializeMdOptions,
) => {
  const parts: TElement[] = [];
  const strays: TElement[] = [];

  for (const child of bodyOf(node)) {
    if (child.type === "containerDirective" && child.name === part) {
      parts.push(read(child));
      continue;
    }

    const blocks = blocksOf([child], deco, options);
    const last = parts.at(-1);

    if (last === undefined) {
      strays.push(...blocks);
    } else {
      last.children.push(...blocks);
    }
  }

  if (strays.length > 0 || parts.length === 0) {
    const first = read(container(part, []));
    parts.unshift({ ...first, children: strays.length > 0 ? strays : first.children });
  }

  return parts;
};

const readContainer = (
  node: ContainerDirective,
  deco: MdDecoration,
  options: DeserializeMdOptions,
) => {
  const containerName = containerDirectiveSchema.parse(node.name);

  switch (containerName) {
    case "toggle": {
      const [head] = node.children;

      const children: RootContent[] = isLabel(head)
        ? [{ children: head.children, type: "paragraph" }, ...node.children.slice(1)]
        : node.children;

      return { children: blocksOf(children, deco, options), type: KEYS.toggle } satisfies TElement;
    }

    case "columns": {
      return {
        children: partsOf(node, "column", (child) => columnOf(child, deco, options), deco, options),
        type: KEYS.columnGroup,
      } satisfies TElement;
    }

    case "column": {
      return {
        children: [columnOf(node, deco, options)],
        type: KEYS.columnGroup,
      } satisfies TElement;
    }

    case "tabs": {
      return {
        children: partsOf(node, "tab", (child) => panelOf(child, deco, options), deco, options),
        type: TAB_GROUP_KEY,
      } satisfies TElement;
    }

    case "tab": {
      return { children: [panelOf(node, deco, options)], type: TAB_GROUP_KEY } satisfies TElement;
    }

    case "article": {
      return {
        children: blocksOf(bodyOf(node), deco, options),
        type: ARTICLE_SECTION_KEY,
      } satisfies TElement;
    }

    default: {
      throw new Error(`unexpected ${String(containerName satisfies never)}`);
    }
  }
};

const readTextDirective = (
  node: TextDirective,
  deco: MdDecoration,
  options: DeserializeMdOptions,
) => {
  const label = phrasingText(node.children);

  const directiveName = textDirectiveSchema.parse(node.name);

  switch (directiveName) {
    case "date": {
      return { children: [{ text: "" }], date: label, type: KEYS.date } satisfies TElement;
    }

    case "formula": {
      const { name, source } = formulaAttributesSchema.parse(node.attributes);

      const pill: TElement = {
        children: [{ text: "" }],
        display: label,
        source,
        type: FORMULA_PILL_KEY,
      };

      if (name !== undefined) {
        pill.name = name;
      }

      return pill;
    }

    case "highlight": {
      return convertChildrenDeserialize(
        node.children,
        { ...deco, [KEYS.highlight]: true },
        options,
      );
    }

    default: {
      throw new Error(`unexpected ${String(directiveName satisfies never)}`);
    }
  }
};

const textDirective = (
  name: TextDirectiveName,
  label: string,
  attributes: Record<string, string>,
) =>
  ({
    attributes,
    children: labelPhrasing(label),
    name,
    type: "textDirective",
  }) satisfies TextDirective;

const richFence = (lang: string) => (node: TElement) =>
  ({ lang, type: "code", value: stringProp(node, "value") ?? "" }) satisfies Code;

const embedRule: WideMdRule = {
  serialize: (node: TElement) =>
    ({
      children: [{ type: "image", url: stringProp(node, "url") ?? "" }],
      type: "paragraph",
    }) satisfies Paragraph,
};

const hasCaption = (node: TElement) => {
  const { caption } = node;

  return (
    Array.isArray(caption) &&
    caption.some((part) => NodeApi.isNode(part) && NodeApi.string(part) !== "")
  );
};

const embedFromImage = (block: TElement) => {
  const url = stringProp(block, "url");

  if (
    block.type !== KEYS.img ||
    url === undefined ||
    block.title !== undefined ||
    hasCaption(block)
  ) {
    return block;
  }

  const type = embedTypeForUrl(url);

  return (type === null ? block : { children: [{ text: "" }], type, url }) satisfies TElement;
};

const isTextLeaf = (node: Descendant | undefined): node is TText =>
  node !== undefined && TextApi.isText(node);

const trimEdges = (block: TElement, before: boolean, after: boolean) => {
  const children = [...block.children];
  const [first] = children;

  if (before && isTextLeaf(first) && first.text.startsWith("\n")) {
    children[0] = { ...first, text: first.text.slice(1) };
  }

  const last = children.at(-1);

  if (after && isTextLeaf(last) && last.text.endsWith("\n")) {
    children[children.length - 1] = { ...last, text: last.text.slice(0, -1) };
  }

  return { ...block, children } satisfies TElement;
};

const isBlankLine = (node: Descendant | undefined) =>
  node !== undefined &&
  ElementApi.isElement(node) &&
  node.type === KEYS.p &&
  node.children.every((child) => TextApi.isText(child) && child.text.trim() === "");

const readParagraph = (node: Paragraph, deco: MdDecoration, options: DeserializeMdOptions) => {
  const read: TElement | TElement[] = defaultParagraph(node, deco, options);

  if (!Array.isArray(read)) {
    return embedFromImage(read);
  }

  const blocks = read.map((block: TElement, index) =>
    block.type === KEYS.p
      ? trimEdges(block, read[index - 1] !== undefined, read[index + 1] !== undefined)
      : embedFromImage(block),
  );

  return blocks.filter((block) => !isBlankLine(block));
};

const MENTION_SCHEME = "mention:";

const decodedKey = (raw: string) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const isPicture = (node: Descendant) => ElementApi.isElement(node) && node.type === KEYS.img;

const isBlankText = (node: Descendant) => TextApi.isText(node) && node.text.trim() === "";

const picturesFirst = (link: TElement) => {
  const pictures = link.children.filter(isPicture);

  if (pictures.length === 0) {
    return link;
  }

  const words = link.children.filter((child) => !isPicture(child));

  return (
    words.every(isBlankText) ? pictures : [...pictures, { ...link, children: words }]
  ) satisfies TElement | Descendant[];
};

const readLink = (node: Link, deco: MdDecoration, options: DeserializeMdOptions) => {
  if (!node.url.startsWith(MENTION_SCHEME)) {
    return picturesFirst(defaultLink(node, deco, options));
  }

  const words = convertChildrenDeserialize(node.children, deco, options);
  const key = decodedKey(node.url.slice(MENTION_SCHEME.length));

  if (key === "") {
    return words;
  }

  const shown = words.map((word) => NodeApi.string(word)).join("");

  const mention: TElement = {
    children: [{ text: "" }],
    key,
    type: KEYS.mention,
    value: shown === UNTITLED ? "" : shown,
  };

  const pictures = words.filter(isPicture);

  return (pictures.length === 0 ? mention : [...pictures, mention]) satisfies
    | TElement
    | Descendant[];
};

export const mentionLink = (key: string, title: string) =>
  ({
    children: [{ type: "text", value: title === "" ? UNTITLED : title }],
    type: "link",
    url: `${MENTION_SCHEME}${encodeURIComponent(key)}`,
  }) satisfies Link;

const writeMention = (node: TElement) => {
  const value = stringProp(node, "value") ?? "";

  return mentionLink(stringProp(node, "key") ?? value, value);
};

const readBlockquote = (node: Blockquote, deco: MdDecoration, options: DeserializeMdOptions) => {
  const quote: TElement = defaultQuote(node, deco, options);
  const alert = node.data?.alert;

  return (alert === undefined ? quote : { ...quote, alert }) satisfies TElement;
};

const writeBlockquote = (node: TElement, options: SerializeMdOptions) => {
  const stock = defaultBlockquote(node, options);
  const quote = { ...stock, children: nestInLists(stock.children) };
  const alert = alertProp(node);

  if (alert === undefined) {
    return quote;
  }

  const marker = `[!${alert}]`;
  const [first, ...others] = quote.children;

  if (first?.type !== "paragraph") {
    const line: Paragraph = { children: [{ type: "html", value: marker }], type: "paragraph" };

    return { ...quote, children: [line, ...quote.children] } satisfies Blockquote;
  }

  const words = first.children.filter(
    (child) => child.type !== "text" || child.value !== ZERO_WIDTH_SPACE,
  );

  const lead: Html = { type: "html", value: words.length === 0 ? marker : `${marker}\n` };

  return {
    ...quote,
    children: [{ ...first, children: [lead, ...words] }, ...others],
  } satisfies Blockquote;
};

const TODO_TEXT_RE = /^\[(?<mark>[ xX])\]$/u;

const headOf = (item: ListItem, head: ListItem["children"][number] | undefined) => {
  const [only, ...others] = head?.type === "paragraph" ? head.children : [];

  const todo =
    only?.type === "text" && others.length === 0 && (item.checked ?? null) === null
      ? TODO_TEXT_RE.exec(only.value)
      : null;

  if (todo === null || head?.type !== "paragraph") {
    return item;
  }

  return {
    ...item,
    checked: todo.groups?.mark !== " ",
    children: [{ ...head, children: [] }, ...item.children.slice(1)],
  } satisfies ListItem;
};

const lineBeforeImage = (head: Paragraph) => {
  const at = head.children.findIndex((child) => child.type === "image");

  return (
    at === -1
      ? [head]
      : [
          { children: head.children.slice(0, at), type: "paragraph" },
          { children: head.children.slice(at), type: "paragraph" },
        ]
  ) satisfies Paragraph[];
};

const itemOf = (item: ListItem, nest: (list: List) => List) => {
  const children = item.children.map((child) => (child.type === "list" ? nest(child) : child));
  const [head, ...rest] = children;

  if (head === undefined) {
    return headOf(item, head);
  }

  if (head.type === "paragraph") {
    const [line, ...after] = lineBeforeImage(head);

    return headOf({ ...item, children: [line ?? head, ...after, ...rest] }, line);
  }

  if (head.type === "heading") {
    return {
      ...item,
      children: [{ children: head.children, type: "paragraph" }, ...rest],
    } satisfies ListItem;
  }

  if (head.type === "html") {
    return {
      ...item,
      children: [{ children: [head], type: "paragraph" }, ...rest],
    } satisfies ListItem;
  }

  return {
    ...item,
    children: [{ children: [], type: "paragraph" }, ...children],
  } satisfies ListItem;
};

const unstickTodo = (block: TElement) =>
  (block.listStyleType === "todo" && block.checked === undefined
    ? { ...block, listStyleType: block.listStart === undefined ? "disc" : "decimal" }
    : block) satisfies TElement;

const listOf = (list: List) =>
  ({
    ...list,
    children: list.children.map((item) => itemOf(item, listOf)),
  }) satisfies List;

const BR_RE = /^<br\s*\/?>$/iu;

const isBreakLeaf = (child: Descendant): child is TText =>
  TextApi.isText(child) && child.text.includes("\n");

const cellBlocks = (block: Descendant) => {
  if (!ElementApi.isElement(block) || block.type !== KEYS.p) {
    return [block] satisfies Descendant[];
  }

  const lines: Descendant[][] = [[]];

  for (const child of block.children) {
    if (TextApi.isText(child) && child.text === ZERO_WIDTH_SPACE) {
      continue;
    }

    if (!isBreakLeaf(child)) {
      lines.at(-1)?.push(child);
      continue;
    }

    const parts = child.text.split("\n");

    for (const [index, part] of parts.entries()) {
      if (index > 0) {
        lines.push([]);
      }

      if (part !== "") {
        lines.at(-1)?.push({ ...child, text: part });
      }
    }
  }

  return lines.map((children) => ({
    ...block,
    children: children.length > 0 ? children : [{ text: "" }],
  }));
};

const isParagraph = (node: Descendant) => ElementApi.isElement(node) && node.type === KEYS.p;

const cellChildren = (children: readonly Descendant[]) => {
  const out: Descendant[] = [];

  for (const [index, child] of children.entries()) {
    const lines = cellBlocks(child);
    const before = children[index - 1];
    const after = children[index + 1];

    if (lines.length > 1 && before !== undefined && !isParagraph(before) && isBlankLine(lines[0])) {
      lines.shift();
    }

    if (
      lines.length > 0 &&
      after !== undefined &&
      !isParagraph(after) &&
      isBlankLine(lines.at(-1))
    ) {
      lines.pop();
    }

    out.push(...lines);
  }

  return (out.length > 0 ? out : [emptyParagraph()]) satisfies Descendant[];
};

const splitCells = (row: Descendant, width: number, rowIndex: number) => {
  if (!ElementApi.isElement(row)) {
    return row;
  }

  const cells = row.children.map((cell) =>
    ElementApi.isElement(cell) ? { ...cell, children: cellChildren(cell.children) } : cell,
  );

  const pad = Array.from({ length: Math.max(0, width - cells.length) }, () => ({
    children: [emptyParagraph()],
    type: rowIndex === 0 ? KEYS.th : KEYS.td,
  }));

  return { ...row, children: [...cells, ...pad] } satisfies Descendant;
};

const writeCell = (node: TElement, options: SerializeMdOptions) => {
  const cell: TableCell = defaultCell(node, options);

  return {
    ...cell,
    children: cell.children.filter(
      (child) => !(child.type === "text" && child.value === ZERO_WIDTH_SPACE),
    ),
  } satisfies TableCell;
};

export const yamlCodeBlock = (yaml: string) =>
  ({
    children: yaml.split("\n").map((line) => ({ children: [{ text: line }], type: KEYS.codeLine })),
    lang: "yaml",
    type: KEYS.codeBlock,
  }) satisfies TElement;

const footnoteLabel = (node: FootnoteReference | FootnoteDefinition) =>
  `[^${node.label ?? node.identifier}]`;

const readFootnoteDefinition = (
  node: FootnoteDefinition,
  deco: MdDecoration,
  options: DeserializeMdOptions,
) => {
  const lead: TText = { text: `${footnoteLabel(node)}: ` };
  const [first, ...rest] = blocksOf(node.children, deco, options);

  if (first?.type === KEYS.p) {
    return [{ ...first, children: [lead, ...first.children] }, ...rest] satisfies TElement[];
  }

  return [
    { children: [lead], type: KEYS.p },
    ...(first === undefined ? [] : [first]),
    ...rest,
  ] satisfies TElement[];
};

const columnDirective = (node: TElement, options: SerializeMdOptions) => {
  const width = stringProp(node, "width");

  return container("column", flowOf(node.children, options), width === undefined ? {} : { width });
};

const writeFormula = (node: TElement) => {
  const name = stringProp(node, "name");
  const source = stringProp(node, "source") ?? "";

  return textDirective(
    "formula",
    stringProp(node, "display") ?? "",
    name === undefined ? { source } : { name, source },
  );
};

const linkRule: WideMdRule = {
  deserialize: readLink,
  serialize: (node: TElement, options: SerializeMdOptions) =>
    ({
      children: convertNodesSerialize(node.children, options).filter(
        (child): child is PhrasingContent => !isFlow(child),
      ),
      type: "link",
      url: stringProp(node, "url") ?? "",
    }) satisfies Link,
};

const blockquoteRule: WideMdRule = { deserialize: readBlockquote, serialize: writeBlockquote };

const inlineEquationRule: WideMdRule = {
  serialize: (node: TElement) => {
    const value = stringProp(node, "texExpression") ?? "";

    return value === "" ? undefined : { type: "inlineMath", value };
  },
};

const paragraphRule: WideMdRule = { deserialize: readParagraph };

const cellRule: WideMdRule = { serialize: writeCell };

export const MD_RULES: MdRules = {
  [LIST_NESTED_KEY]: {
    serialize: (node: TElement, options: SerializeMdOptions) => {
      const inner = convertNodesSerialize(node.children, options).find(isFlow);
      const listDepth = numberProp(node, LIST_DEPTH_KEY);

      return inner === undefined ? undefined : { ...inner, data: { ...inner.data, listDepth } };
    },
  },

  a: linkRule,

  [ARTICLE_SECTION_KEY]: {
    serialize: (node: TElement, options: SerializeMdOptions) =>
      container("article", flowOf(node.children, options)),
  },

  blockquote: blockquoteRule,

  [CANVAS_BLOCK_KEY]: { serialize: richFence(CANVAS_LANG) },

  [CHART_BLOCK_KEY]: { serialize: richFence(CHART_LANG) },

  code_block: {
    deserialize: (node: Code, deco: MdDecoration, options: DeserializeMdOptions) => {
      const richBlock = RICH_FENCE_LANGS.get(node.lang ?? "");

      return (
        richBlock === undefined
          ? defaultCodeBlock(node, deco, options)
          : { children: [{ text: "" }], type: richBlock, value: node.value }
      ) satisfies TElement;
    },
  },

  [KEYS.column]: {
    serialize: (node: TElement, options: SerializeMdOptions) =>
      container("columns", [columnDirective(node, options)]),
  },

  [KEYS.columnGroup]: {
    serialize: (node: TElement, options: SerializeMdOptions) =>
      container(
        "columns",
        node.children.flatMap((column) =>
          ElementApi.isElement(column) && column.type === KEYS.column
            ? [columnDirective(column, options)]
            : [],
        ),
      ),
  },

  containerDirective: { deserialize: readContainer },

  [KEYS.highlight]: {
    mark: true,
    serialize: () =>
      ({
        attributes: {},
        children: [],
        name: "highlight",
        type: "textDirective",
      }) satisfies TextDirective,
  },

  [KEYS.date]: {
    serialize: (node: TElement) => textDirective("date", stringProp(node, "date") ?? "", {}),
  },

  equation: {
    deserialize: (node: MdMath, deco: MdDecoration, options: DeserializeMdOptions) =>
      defaultEquation(
        { ...node, value: [node.meta ?? "", node.value].filter((line) => line !== "").join("\n") },
        deco,
        options,
      ),
  },

  file: embedRule,

  footnoteDefinition: { deserialize: readFootnoteDefinition },

  footnoteReference: {
    deserialize: (node: FootnoteReference, deco: MdDecoration) =>
      ({
        ...deco,
        text: footnoteLabel(node),
      }) satisfies TText,
  },

  [FORMULA_PILL_KEY]: { serialize: writeFormula },

  [HTML_BLOCK_KEY]: { serialize: richFence(HTML_LANG) },

  html: {
    deserialize: (node: Html, deco: MdDecoration) =>
      ({
        ...deco,
        text: BR_RE.test(node.value.trim()) ? "\n" : node.value,
      }) satisfies TText,
  },

  inline_equation: inlineEquationRule,

  list: {
    deserialize: (node: List, deco: MdDecoration, options: DeserializeMdOptions) => {
      const read: unknown = defaultList(listOf(node), deco, options);

      return (
        Array.isArray(read)
          ? read.filter((block) => ElementApi.isElement(block)).map(unstickTodo)
          : []
      ) satisfies Descendant[];
    },
  },

  media_embed: embedRule,

  mention: { serialize: writeMention },

  p: paragraphRule,

  [TAB_GROUP_KEY]: {
    serialize: (node: TElement, options: SerializeMdOptions) =>
      container(
        "tabs",
        node.children.flatMap((panel) =>
          ElementApi.isElement(panel) && panel.type === TAB_PANEL_KEY
            ? [
                container("tab", [
                  ...labelParagraph(stringProp(panel, "label") ?? ""),
                  ...flowOf(panel.children, options),
                ]),
              ]
            : [],
        ),
      ),
  },

  table: {
    deserialize: (node: Table, deco: MdDecoration, options: DeserializeMdOptions) => {
      const table: TElement = defaultTable(node, deco, options);
      const width = Math.max(0, ...node.children.map((row) => row.children.length));

      return {
        ...table,
        children: table.children.map((row, index) => splitCells(row, width, index)),
      } satisfies TElement;
    },
  },

  td: cellRule,

  th: cellRule,

  textDirective: { deserialize: readTextDirective },

  [KEYS.toggle]: {
    serialize: (node: TElement, options: SerializeMdOptions) =>
      container("toggle", flowOf(node.children, options)),
  },

  video: embedRule,

  yaml: { deserialize: (node: Yaml) => yamlCodeBlock(node.value) },
};
