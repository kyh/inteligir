// The rules Plate's own table lacks or gets wrong for the library's nodes. Deserialize routes by
// mdast type, serialize by the Slate node's plugin key; every other node is Plate's stock rule.

import type {
  BlockContent,
  Code,
  DefinitionContent,
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
import { ElementApi, KEYS, NodeApi, TextApi } from "platejs";
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
} from "@repo/editor/dialect-node-keys";
import { embedTypeForUrl } from "@repo/editor/lib/embed-url";
import { writtenAlertMarker } from "@repo/editor/markdown/alert-marker";
import {
  CANVAS_LANG,
  CHART_LANG,
  HTML_LANG,
  RICH_FENCE_LANGS,
} from "@repo/editor/markdown/fence-langs";
import { numberProp, stringProp } from "@repo/editor/node-props";

declare module "mdast" {
  interface Data {
    // the list depth a block nested in a list item rides to `nestInLists`
    listDepth?: number;
  }
}

type WideMdRule = NonNullable<MdRules[string]>;

type FlowContent = BlockContent | DefinitionContent;
type ContainerDirective = Extract<RootContent, { type: "containerDirective" }>;
type TextDirective = Extract<PhrasingContent, { type: "textDirective" }>;

// the codec's wrapper for an item's article section, which no editor node holds
export const ARTICLE_SECTION_KEY = "article_section";

const required = <T>(rule: T | null | undefined, key: string): T => {
  if (rule === undefined || rule === null) {
    throw new Error(`@platejs/markdown lost its ${key} rule`);
  }
  return rule;
};

const defaultParagraph = required(defaultRules.p?.deserialize, "p");
const defaultLink = required(defaultRules.a?.deserialize, "a");
const defaultBlockquote = required(defaultRules.blockquote?.serialize, "blockquote");
const defaultEquation = required(defaultRules.equation?.deserialize, "equation");
const defaultCodeBlock = required(defaultRules.code_block?.deserialize, "code_block");
const defaultList = required(defaultRules.list?.deserialize, "list");
const defaultTable = required(defaultRules.table?.deserialize, "table");
const defaultCell = required(defaultRules.td?.serialize, "td");

const emptyParagraph = (): TElement => ({ children: [{ text: "" }], type: KEYS.p });

const FLOW_TYPES: ReadonlySet<string> = new Set([
  "blockquote",
  "code",
  "containerDirective",
  "definition",
  "footnoteDefinition",
  "heading",
  "html",
  "leafDirective",
  "list",
  "math",
  "paragraph",
  "table",
  "thematicBreak",
  "yaml",
]);

const isFlow = (node: { type: string }): node is FlowContent => FLOW_TYPES.has(node.type);

// Blocks inside a container: a bare leaf (flow html reads as one) goes into a paragraph, since a
// container holds blocks, and an empty container still holds its one line.
const blocksOf = (
  children: readonly RootContent[],
  deco: MdDecoration,
  options: DeserializeMdOptions,
): TElement[] => {
  const blocks: TElement[] = [];
  for (const node of convertChildrenDeserialize([...children], deco, options)) {
    if (ElementApi.isElement(node)) {
      blocks.push(node);
    } else if (TextApi.isText(node) && node.text !== "") {
      blocks.push({ children: [node], type: KEYS.p });
    }
  }
  return blocks.length > 0 ? blocks : [emptyParagraph()];
};

const isEmptyParagraph = (node: Descendant | undefined): boolean =>
  node !== undefined &&
  ElementApi.isElement(node) &&
  node.type === KEYS.p &&
  node.children.every((child) => TextApi.isText(child) && child.text === "");

// the wrapper a block nested in a list item rides to the writer, which no editor node holds
const LIST_NESTED_KEY = "list_nested";

const LIST_DEPTH_KEY = "listDepth";

const isListLine = (block: TElement): boolean => block.type === KEYS.p && "listStyleType" in block;

const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  ARTICLE_SECTION_KEY,
  KEYS.blockquote,
  KEYS.column,
  KEYS.columnGroup,
  KEYS.toggle,
  TAB_GROUP_KEY,
  TAB_PANEL_KEY,
]);

// Plate writes only a paragraph as a list item, so every other block with an indent, which its
// list rule reads under the item it nests in, is marked here and nested by `nestInLists`
export const markListNesting = (blocks: readonly Descendant[]): Descendant[] =>
  blocks.map((block) => {
    if (!ElementApi.isElement(block)) {
      return block;
    }
    const inner: TElement = CONTAINER_TYPES.has(block.type)
      ? { ...block, children: markListNesting(block.children) }
      : block;
    const indent = numberProp(inner, "indent");
    if (isListLine(inner) || indent === undefined) {
      return inner;
    }
    const { indent: _indent, listStyleType: _style, checked: _checked, ...rest } = inner;
    return { children: [rest], [LIST_DEPTH_KEY]: indent, type: LIST_NESTED_KEY };
  });

const isEmptyInlineEquation = (node: Descendant): boolean =>
  ElementApi.isElement(node) &&
  node.type === KEYS.inlineEquation &&
  (stringProp(node, "texExpression") ?? "") === "";

const withoutEmptyEquations = (node: Descendant): Descendant => {
  if (!ElementApi.isElement(node)) {
    return node;
  }
  const kept = node.children
    .filter((child) => !isEmptyInlineEquation(child))
    .map(withoutEmptyEquations);
  return { ...node, children: kept.length > 0 ? kept : [{ text: "" }] };
};

// An empty equation leaves before any text run is converted, so its neighbours join into one run
// rather than two whose marks collide (`**a**__b__`), and a block it alone filled keeps an empty
// text. It sits in a heading or a list item as readily as a paragraph, so this walks the value.
export const pruneEmptyEquations = (value: readonly Descendant[]): Descendant[] =>
  value.map(withoutEmptyEquations);

const isList = (node: RootContent | undefined): node is List => node?.type === "list";

// the list item `depth` levels down a list's last items
const itemAt = (list: List, depth: number): ListItem | null => {
  let item = list.children.at(-1) ?? null;
  for (let level = 1; level < depth && item !== null; level += 1) {
    const last = item.children.at(-1);
    if (last?.type !== "list") {
      break;
    }
    item = last.children.at(-1) ?? null;
  }
  return item;
};

// a block marked with its list depth goes into the item it nests under, which is how markdown
// spells a block inside a list item; with no list before it, it stands where it is
// Plate ends a list at the first block that is not an item, so the list after a nested block goes
// on the one before it, as the items it continues; an item holding a block is loose, since a tight
// item writes a table and the paragraph after it as one table
export const nestInLists = <Node extends RootContent>(children: readonly Node[]): Node[] => {
  const out: Node[] = [];
  let nested = false;
  for (const child of children) {
    const depth = child.data?.listDepth ?? null;
    const last = out.at(-1);
    const item = depth !== null && isList(last) ? itemAt(last, depth - 1) : null;
    if (item !== null && isFlow(child)) {
      // an item with no words opens with its block, since `-` then a blank line is an empty item
      // and what follows stands outside the list
      const [head, ...rest] = item.children;
      const wordless =
        rest.length === 0 &&
        head?.type === "paragraph" &&
        head.children.every((leaf) => leaf.type === "text" && leaf.value === "");
      item.children = wordless ? [child] : [...item.children, child];
      item.spread = true;
      nested = true;
    } else if (nested && isList(child) && isList(last) && last.ordered === child.ordered) {
      last.children.push(...child.children);
    } else {
      out.push(child);
      nested = false;
    }
  }
  return out;
};

// a container holding only its empty line writes none, since Plate writes that line as a lone ZWSP
const flowOf = (children: readonly Descendant[], options: SerializeMdOptions): FlowContent[] => {
  const [only, ...rest] = children;
  if (rest.length === 0 && isEmptyParagraph(only)) {
    return [];
  }
  return nestInLists(convertNodesSerialize([...children], options).filter(isFlow));
};

const isLabel = (node: RootContent | undefined): node is Paragraph =>
  node?.type === "paragraph" && node.data?.directiveLabel === true;

// a label's words, through any emphasis or code a hand-written one holds
const phrasingText = (children: readonly PhrasingContent[]): string =>
  children
    .map((child) => {
      if ("children" in child) {
        return phrasingText(child.children);
      }
      return "value" in child ? child.value : "";
    })
    .join("");

// what would read as a construct inside a label and change its words: an escape, a code span,
// emphasis, a strikethrough, a bracket, a tag or autolink, an entity, math, a directive, a cell's
// pipe; a date's hyphens and a number's comma read as themselves
const LABEL_SYNTAX = /[$&*:<[\\\]_`|~]/gu;

// A label is a string, so what would read as syntax in it is written escaped: the directive writer
// escapes only what would close the label, and `*y*` would read back as emphasis.
const labelPhrasing = (label: string): PhrasingContent[] =>
  label === "" ? [] : [{ type: "html", value: label.replaceAll(LABEL_SYNTAX, String.raw`\$&`) }];

const labelOf = (node: ContainerDirective): string => {
  const [head] = node.children;
  return isLabel(head) ? phrasingText(head.children) : "";
};

// what a container holds below its label
const bodyOf = (node: ContainerDirective): RootContent[] =>
  isLabel(node.children[0]) ? node.children.slice(1) : node.children;

const labelParagraph = (label: string): Paragraph[] =>
  label === ""
    ? []
    : [
        {
          children: labelPhrasing(label),
          data: { directiveLabel: true },
          type: "paragraph",
        },
      ];

const container = (
  name: string,
  children: FlowContent[],
  attributes: Record<string, string> = {},
): ContainerDirective => ({ attributes, children, name, type: "containerDirective" });

const WIDTH_RE = /^\d+(?:\.\d+)?%$/u;

const columnOf = (
  node: ContainerDirective,
  deco: MdDecoration,
  options: DeserializeMdOptions,
): TElement => {
  const column: TElement = { children: blocksOf(bodyOf(node), deco, options), type: KEYS.column };
  const width = node.attributes?.width;
  if (width !== undefined && width !== null && WIDTH_RE.test(width)) {
    column.width = width;
  }
  return column;
};

const panelOf = (
  node: ContainerDirective,
  deco: MdDecoration,
  options: DeserializeMdOptions,
): TElement => ({
  children: blocksOf(bodyOf(node), deco, options),
  label: labelOf(node),
  type: TAB_PANEL_KEY,
});

// what a group holds that is not one of its own parts goes into the part before it (or a first
// part made for it), so nothing it held is dropped
const partsOf = (
  node: ContainerDirective,
  part: string,
  read: (child: ContainerDirective) => TElement,
  deco: MdDecoration,
  options: DeserializeMdOptions,
): TElement[] => {
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
): TElement | TElement[] => {
  switch (node.name) {
    case "toggle": {
      // a label is the toggle's first line; the writer leaves it unlabelled, since a label holds
      // only phrasing and the first line may be a heading
      const [head] = node.children;
      const children: RootContent[] = isLabel(head)
        ? [{ children: head.children, type: "paragraph" }, ...node.children.slice(1)]
        : node.children;
      return { children: blocksOf(children, deco, options), type: KEYS.toggle };
    }
    case "columns": {
      return {
        children: partsOf(node, "column", (child) => columnOf(child, deco, options), deco, options),
        type: KEYS.columnGroup,
      };
    }
    case "column": {
      return { children: [columnOf(node, deco, options)], type: KEYS.columnGroup };
    }
    case "tabs": {
      return {
        children: partsOf(node, "tab", (child) => panelOf(child, deco, options), deco, options),
        type: TAB_GROUP_KEY,
      };
    }
    case "tab": {
      return { children: [panelOf(node, deco, options)], type: TAB_GROUP_KEY };
    }
    case "article": {
      return { children: blocksOf(bodyOf(node), deco, options), type: ARTICLE_SECTION_KEY };
    }
    default: {
      return blocksOf(node.children, deco, options);
    }
  }
};

const readTextDirective = (node: TextDirective): TElement => {
  const label = phrasingText(node.children);
  if (node.name === "date") {
    return { children: [{ text: "" }], date: label, type: KEYS.date };
  }
  const pill: TElement = {
    children: [{ text: "" }],
    display: label,
    source: node.attributes?.source ?? "",
    type: FORMULA_PILL_KEY,
  };
  const meta = node.attributes?.meta ?? "";
  if (meta !== "") {
    pill.meta = meta;
  }
  return pill;
};

const textDirective = (
  name: string,
  label: string,
  attributes: Record<string, string>,
): TextDirective => ({
  attributes,
  children: labelPhrasing(label),
  name,
  type: "textDirective",
});

const richFence =
  (lang: string) =>
  (node: TElement): Code => ({ lang, type: "code", value: stringProp(node, "value") ?? "" });

// an embed is `![](url)`, the image syntax every markdown reader embeds a url with
const embedRule: WideMdRule = {
  serialize: (node: TElement): Paragraph => ({
    children: [{ type: "image", url: stringProp(node, "url") ?? "" }],
    type: "paragraph",
  }),
};

const hasCaption = (node: TElement): boolean => {
  const { caption } = node;
  return (
    Array.isArray(caption) &&
    caption.some((part) => NodeApi.isNode(part) && NodeApi.string(part) !== "")
  );
};

// an image on the web with no alt and no title reads back as the embed that wrote it
const embedFromImage = (block: TElement): TElement => {
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
  return type === null ? block : { children: [{ text: "" }], type, url };
};

const isTextLeaf = (node: Descendant | undefined): node is TText =>
  node !== undefined && TextApi.isText(node);

// the line break beside an image Plate cut out of a paragraph is the image's own block edge
const trimEdges = (block: TElement, before: boolean, after: boolean): TElement => {
  const children = [...block.children];
  const [first] = children;
  if (before && isTextLeaf(first) && first.text.startsWith("\n")) {
    children[0] = { ...first, text: first.text.slice(1) };
  }
  const last = children.at(-1);
  if (after && isTextLeaf(last) && last.text.endsWith("\n")) {
    children[children.length - 1] = { ...last, text: last.text.slice(0, -1) };
  }
  return { ...block, children };
};

const blankParagraph = (block: TElement): boolean =>
  block.type === KEYS.p &&
  block.children.every((child) => TextApi.isText(child) && child.text.trim() === "");

const readParagraph = (
  node: Paragraph,
  deco: MdDecoration,
  options: DeserializeMdOptions,
): TElement | TElement[] => {
  const read: TElement | TElement[] = defaultParagraph(node, deco, options);
  if (!Array.isArray(read)) {
    return embedFromImage(read);
  }
  const blocks = read.map((block: TElement, index) =>
    block.type === KEYS.p
      ? trimEdges(block, read[index - 1] !== undefined, read[index + 1] !== undefined)
      : embedFromImage(block),
  );
  return blocks.filter((block) => !blankParagraph(block));
};

const MENTION_SCHEME = "mention:";

const decodedKey = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

// a page link is `[Title](mention:<id>)`, the spelling Plate's mention writes; read here rather than
// by remarkMention, which also reads every `@word` as one
const readLink = (
  node: Link,
  deco: MdDecoration,
  options: DeserializeMdOptions,
): TElement | Descendant[] => {
  if (!node.url.startsWith(MENTION_SCHEME)) {
    return defaultLink(node, deco, options);
  }
  const words = convertChildrenDeserialize(node.children, deco, options);
  const key = decodedKey(node.url.slice(MENTION_SCHEME.length));
  if (key === "") {
    return words;
  }
  const shown = words.map((word) => NodeApi.string(word)).join("");
  return {
    children: [{ text: "" }],
    key,
    type: KEYS.mention,
    value: shown === UNTITLED ? "" : shown,
  };
};

// Plate's own mention spelling, `[value](mention:<key>)`, but an untitled item's link still shows a
// word, as every surface draws it, since `[](mention:id)` is no link to CommonMark's eye; the read
// takes that word back to no title
const writeMention = (node: TElement): Link => {
  const value = stringProp(node, "value") ?? "";
  return {
    children: [{ type: "text", value: value === "" ? UNTITLED : value }],
    type: "link",
    url: `${MENTION_SCHEME}${encodeURIComponent(stringProp(node, "key") ?? value)}`,
  };
};

// what follows an alert's marker on its line: its break is a plain newline, since the writer would
// end the marker's line with a hard break
const afterMarker = (tail: string, after: PhrasingContent | undefined): PhrasingContent[] => {
  if (after === undefined) {
    return [];
  }
  return after.type === "break" && tail === "" ? [{ type: "html", value: "\n" }] : [after];
};

// GitHub's alert opens `> [!NOTE]` on a line of its own; the writer would escape the `[`, so the
// marker goes as written
const writeBlockquote = (node: TElement, options: SerializeMdOptions): RootContent => {
  const quote = defaultBlockquote(node, options);
  const [first, ...others] = quote.children;
  if (first?.type !== "paragraph") {
    return quote;
  }
  const [lead, after, ...rest] = first.children;
  const written = lead?.type === "text" ? writtenAlertMarker(lead.value) : null;
  if (written === null || lead?.type !== "text") {
    return quote;
  }
  const tail = lead.value.slice(written.length);
  const marker: PhrasingContent[] = [{ type: "html", value: written }];
  if (tail !== "") {
    marker.push({ type: "text", value: tail });
  }
  return {
    ...quote,
    children: [
      { ...first, children: [...marker, ...afterMarker(tail, after), ...rest] },
      ...others,
    ],
  };
};

const TODO_TEXT_RE = /^\[(?<mark>[ xX])\]$/u;

const headOf = (item: ListItem, head: ListItem["children"][number] | undefined): ListItem => {
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
  };
};

// A picture is a block wherever it stands, and Plate's list rule makes every block its line reads
// as a paragraph, so the line ends at its first picture and the rest nests under it
const lineBeforeImage = (head: Paragraph): Paragraph[] => {
  const at = head.children.findIndex((child) => child.type === "image");
  return at === -1
    ? [head]
    : [
        { children: head.children.slice(0, at), type: "paragraph" },
        { children: head.children.slice(at), type: "paragraph" },
      ];
};

// Plate's list rule makes an item's first child its line and nests the rest. An item that opens
// with another block keeps an empty line, so the block nests under it rather than turning into a
// paragraph that holds none of it; a heading's words are the line, and `- [ ]` with nothing after
// its box, which micromark reads as text, is an empty to-do.
const itemOf = (item: ListItem, nest: (list: List) => List): ListItem => {
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
    return { ...item, children: [{ children: head.children, type: "paragraph" }, ...rest] };
  }
  if (head.type === "html") {
    return { ...item, children: [{ children: [head], type: "paragraph" }, ...rest] };
  }
  return { ...item, children: [{ children: [], type: "paragraph" }, ...children] };
};

// Plate's list rule keeps a list's style at todo from its first to-do on, so a bullet after one
// reads as a to-do with no box; a to-do always carries its box, so one without is the list's own
const unstickTodo = (block: TElement): TElement =>
  block.listStyleType === "todo" && block.checked === undefined
    ? { ...block, listStyleType: block.listStart === undefined ? "disc" : "decimal" }
    : block;

const listOf = (list: List): List => ({
  ...list,
  children: list.children.map((item) => itemOf(item, listOf)),
});

const BR_RE = /^<br\s*\/?>$/iu;

// Plate writes an empty cell's line as a lone zero-width space, which a cell (no paragraph to
// Plate's reader) keeps
const ZWSP = "\u200B";

const isBreakLeaf = (child: Descendant): child is TText =>
  TextApi.isText(child) &&
  (child.rawHtml === true ? BR_RE.test(child.text) : child.text.includes("\n"));

// Plate joins a cell's blocks with `<br/>` and reads the tag back as raw html, so a cell's blocks
// are cut at it again
const cellBlocks = (block: Descendant): Descendant[] => {
  if (!ElementApi.isElement(block) || block.type !== KEYS.p) {
    return [block];
  }
  const lines: Descendant[][] = [[]];
  for (const child of block.children) {
    if (TextApi.isText(child) && child.text === ZWSP) {
      continue;
    }
    if (!isBreakLeaf(child)) {
      lines.at(-1)?.push(child);
      continue;
    }
    const parts = child.rawHtml === true ? ["", ""] : child.text.split("\n");
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

const isParagraph = (node: Descendant): boolean =>
  ElementApi.isElement(node) && node.type === KEYS.p;

// a line of spaces alone, which gfm trims off a cell's edge, so it holds no words of the cell's
const isBlankLine = (node: Descendant | undefined): boolean =>
  node !== undefined &&
  ElementApi.isElement(node) &&
  node.type === KEYS.p &&
  node.children.every((child) => TextApi.isText(child) && child.text.trim() === "");

// an image is a block wherever it stands in a cell, so the tag beside one, a space between them or
// not, is the edge it already has
const cellChildren = (children: readonly Descendant[]): Descendant[] => {
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
  return out.length > 0 ? out : [emptyParagraph()];
};

// GFM pads a short row with empty cells, which remark leaves out of the tree
const splitCells = (row: Descendant, width: number, rowIndex: number): Descendant => {
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
  return { ...row, children: [...cells, ...pad] };
};

// an empty cell is empty, where Plate writes its one line as a lone zero-width space
const writeCell = (node: TElement, options: SerializeMdOptions): TableCell => {
  const cell: TableCell = defaultCell(node, options);
  return {
    ...cell,
    children: cell.children.filter((child) => !(child.type === "text" && child.value === ZWSP)),
  };
};

// YAML no field reads, kept as a code block where the person can see and mend it
export const yamlCodeBlock = (yaml: string): TElement => ({
  children: yaml.split("\n").map((line) => ({ children: [{ text: line }], type: KEYS.codeLine })),
  lang: "yaml",
  type: KEYS.codeBlock,
});

const footnoteLabel = (node: FootnoteReference | FootnoteDefinition): string =>
  `[^${node.label ?? node.identifier}]`;

// a footnote is the text it spells: its call `[^1]`, its definition a paragraph led by `[^1]: `
const readFootnoteDefinition = (
  node: FootnoteDefinition,
  deco: MdDecoration,
  options: DeserializeMdOptions,
): TElement[] => {
  const lead: TText = { text: `${footnoteLabel(node)}: ` };
  const [first, ...rest] = blocksOf(node.children, deco, options);
  if (first?.type === KEYS.p) {
    return [{ ...first, children: [lead, ...first.children] }, ...rest];
  }
  return [{ children: [lead], type: KEYS.p }, ...(first === undefined ? [] : [first]), ...rest];
};

const columnDirective = (node: TElement, options: SerializeMdOptions): ContainerDirective => {
  const width = stringProp(node, "width");
  return container("column", flowOf(node.children, options), width === undefined ? {} : { width });
};

const writeFormula = (node: TElement): TextDirective => {
  const meta = stringProp(node, "meta") ?? "";
  const source = stringProp(node, "source") ?? "";
  return textDirective(
    "formula",
    stringProp(node, "display") ?? "",
    meta === "" ? { source } : { meta, source },
  );
};

// `MdRules` narrows a keyed rule's return to that key's node, so a rule that reads one mdast node
// as several, or writes none, is declared against the index signature's wide rule
const linkRule: WideMdRule = {
  deserialize: readLink,
  serialize: (node: TElement, options: SerializeMdOptions): Link => ({
    children: convertNodesSerialize(node.children, options).filter(
      (child): child is PhrasingContent => !isFlow(child),
    ),
    type: "link",
    url: stringProp(node, "url") ?? "",
  }),
};

const blockquoteRule: WideMdRule = { serialize: writeBlockquote };

// markdown has no empty inline math: `$$$$` reads back as text
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

  // a link is always a link node: Plate writes a bare url as raw html, and the writer then turns the
  // hard break before it into a space, and GFM reads the `\\` of one after it into the url
  a: linkRule,

  [ARTICLE_SECTION_KEY]: {
    serialize: (node: TElement, options: SerializeMdOptions) =>
      container("article", flowOf(node.children, options)),
  },

  blockquote: blockquoteRule,

  [CANVAS_BLOCK_KEY]: { serialize: richFence(CANVAS_LANG) },

  [CHART_BLOCK_KEY]: { serialize: richFence(CHART_LANG) },

  code_block: {
    deserialize: (node: Code, deco: MdDecoration, options: DeserializeMdOptions): TElement => {
      const richBlock = RICH_FENCE_LANGS.get(node.lang ?? "");
      return richBlock === undefined
        ? defaultCodeBlock(node, deco, options)
        : { children: [{ text: "" }], type: richBlock, value: node.value };
    },
  },

  // a column outside a group writes a group of one: a column has no spelling of its own
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

  [KEYS.date]: {
    serialize: (node: TElement) => textDirective("date", stringProp(node, "date") ?? "", {}),
  },

  // what follows a `$$` on its line is the fence's meta to remark-math, which a person who opens
  // `$$ E = mc^2` wrote as the expression's first line
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
    deserialize: (node: FootnoteReference, deco: MdDecoration): TText => ({
      ...deco,
      text: footnoteLabel(node),
    }),
  },

  [FORMULA_PILL_KEY]: { serialize: writeFormula },

  [HTML_BLOCK_KEY]: { serialize: richFence(HTML_LANG) },

  // raw html is the text it spells: the persisted set holds no raw leaf, and a `<br>` is the line
  // break Plate's own rule reads
  html: {
    deserialize: (node: Html, deco: MdDecoration): TText => ({
      ...deco,
      text: BR_RE.test(node.value.trim()) ? "\n" : node.value,
    }),
  },

  inline_equation: inlineEquationRule,

  list: {
    deserialize: (node: List, deco: MdDecoration, options: DeserializeMdOptions): Descendant[] => {
      const read: unknown = defaultList(listOf(node), deco, options);
      return Array.isArray(read)
        ? read.filter((block) => ElementApi.isElement(block)).map(unstickTodo)
        : [];
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
    deserialize: (node: Table, deco: MdDecoration, options: DeserializeMdOptions): TElement => {
      const table: TElement = defaultTable(node, deco, options);
      const width = Math.max(0, ...node.children.map((row) => row.children.length));
      return {
        ...table,
        children: table.children.map((row, index) => splitCells(row, width, index)),
      };
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

  yaml: { deserialize: (node: Yaml): TElement => yamlCodeBlock(node.value) },
};
