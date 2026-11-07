// Rule dispatch: deserialize routes by mdast type, serialize by the Slate node's plugin key.

import type { AlignType } from "mdast";
import { ElementApi, KEYS, NodeApi, TextApi } from "platejs";
import type { Descendant, TElement, TLinkElement, TText, Value } from "platejs";
import {
  convertChildrenDeserialize,
  convertNodesSerialize,
  defaultRules,
  serializeMd,
} from "@platejs/markdown";
import type {
  DeserializeMdOptions,
  MDPhrasingContent,
  MdDecoration,
  MdDelete,
  MdEmphasis,
  MdStrong,
  MdRules,
  MdCode,
  MdInlineMath,
  MdLink,
  MdList,
  MdParagraph,
  MdTableRow,
  MdText,
  MdYaml,
  SerializeMdOptions,
} from "@platejs/markdown";
import { z } from "zod";

import { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";
import { isContainerContent } from "@repo/notes/markdown/remark-containers";
import type {
  ArticleSection,
  Column,
  ColumnGroup,
  ContainerContent,
  TabGroup,
  TabPanel,
  Toggle,
} from "@repo/notes/markdown/remark-containers";
import type { BlockRef } from "@repo/notes/markdown/remark-obsidian";
import type { OpaqueInline } from "@repo/notes/markdown/remark-opaque";
import { formulaRawOf, parseFormulaRaw } from "@repo/notes/markdown/remark-inline-constructs";
import type {
  AnnotationMarker,
  DateChip,
  FormulaPill,
} from "@repo/notes/markdown/remark-inline-constructs";
import type { Underline } from "@repo/notes/markdown/remark-inline-html";
import {
  CANVAS_LANG,
  CHART_LANG,
  HTML_LANG,
  RICH_FENCE_LANGS,
} from "@repo/notes/markdown/fence-langs";
import type { WikiEmbed, WikiLink } from "@repo/notes/markdown/remark-wiki-link";

import {
  CANVAS_BLOCK_KEY,
  CHART_BLOCK_KEY,
  ANNOTATION_MARKER_KEY,
  FORMULA_PILL_KEY,
  HTML_BLOCK_KEY,
  OPAQUE_KEY,
  TAB_GROUP_KEY,
  TAB_PANEL_KEY,
  WIKI_EMBED_KEY,
  WIKI_LINK_KEY,
} from "@repo/editor/dialect-node-keys";
import { embedTypeForUrl } from "@repo/editor/lib/embed-url";
import { leadingAlertMarker } from "@repo/notes/markdown/alert-marker";
import { stringProp } from "@repo/editor/node-props";
import { wikiBodyOf, wikiFieldsOf, wikiLabelOf, wikiNodeOfBody } from "@repo/editor/wiki/wiki-node";
import type { WikiNodeType } from "@repo/editor/wiki/wiki-node";

const ensureBlocks = (children: Descendant[]): Descendant[] =>
  children.length > 0 ? children : [{ children: [{ text: "" }], type: "p" }];

// YAML no field reads, kept as a code block where the person can see and mend it
export const yamlCodeBlock = (yaml: string): TElement => ({
  children: yaml
    .split(/\r?\n/u)
    .map((line) => ({ children: [{ text: line }], type: KEYS.codeLine })),
  lang: "yaml",
  type: KEYS.codeBlock,
});

// fail fast if a @platejs/markdown bump reshapes defaultRules.
const defaultCodeBlock = defaultRules.code_block;
const defaultCodeBlockDeserialize = defaultCodeBlock?.deserialize;
if (defaultCodeBlockDeserialize === undefined || defaultCodeBlockDeserialize === null) {
  throw new Error("@platejs/markdown defaultRules.code_block lost its deserialize — pin the bump");
}

const defaultBlockquote = defaultRules.blockquote;
const defaultBlockquoteDeserialize = defaultBlockquote?.deserialize;
const defaultBlockquoteSerialize = defaultBlockquote?.serialize;
if (!defaultBlockquoteDeserialize || !defaultBlockquoteSerialize) {
  throw new Error("@platejs/markdown defaultRules.blockquote is missing — pipeline cannot start");
}
const defaultTable = defaultRules.table;
const defaultTableDeserialize = defaultTable?.deserialize;
const defaultTableSerialize = defaultTable?.serialize;
if (!defaultTableDeserialize || !defaultTableSerialize) {
  throw new Error("@platejs/markdown defaultRules.table is missing — pipeline cannot start");
}
const defaultLink = defaultRules.a;
const defaultLinkDeserialize = defaultLink?.deserialize;
const defaultLinkSerialize = defaultLink?.serialize;
if (!defaultLinkDeserialize || !defaultLinkSerialize) {
  throw new Error("@platejs/markdown defaultRules.a is missing — pipeline cannot start");
}
const defaultEquation = defaultRules.equation;
const defaultEquationDeserialize = defaultEquation?.deserialize;
if (!defaultEquationDeserialize) {
  throw new Error("@platejs/markdown defaultRules.equation is missing — pipeline cannot start");
}
const defaultParagraph = defaultRules.p;
const defaultParagraphDeserialize = defaultParagraph?.deserialize;
const defaultParagraphSerialize = defaultParagraph?.serialize;
if (!defaultParagraphDeserialize || !defaultParagraphSerialize) {
  throw new Error("@platejs/markdown defaultRules.p is missing — pipeline cannot start");
}

// `MdRules` narrows each keyed rule's return to that key's node; rules emitting verbatim bytes or
// no node at all, or deserializing one mdast node into several blocks, are declared against the
// index signature's wide rule instead of casting.
type WideMdRule = NonNullable<MdRules[string]>;

const isEmptyParagraph = (node: Descendant | undefined): boolean => {
  if (node === undefined || !ElementApi.isElement(node) || node.type !== "p") {
    return false;
  }
  const [only, ...rest] = node.children;
  return rest.length === 0 && only !== undefined && TextApi.isText(only) && only.text === "";
};

// a container's blocks; one holding only an empty paragraph writes none, since Plate's p rule
// would spell that paragraph as a line holding a lone ZWSP
const containerFlow = (children: Descendant[], options: SerializeMdOptions): ContainerContent[] => {
  const [only, ...rest] = children;
  if (rest.length === 0 && isEmptyParagraph(only)) {
    return [];
  }
  return convertNodesSerialize(children, options).flatMap((child) =>
    isContainerContent(child) ? [child] : [],
  );
};

const columnOf = (column: TElement, options: SerializeMdOptions): Column => ({
  children: containerFlow(column.children, options),
  type: "column",
  width: stringProp(column, "width") ?? null,
});

// an embed is `![](url)`, the image syntax every markdown reader embeds a url with
const embedRule: WideMdRule = {
  serialize: (node: TElement): MdParagraph => ({
    children: [{ type: "image", url: stringProp(node, "url") ?? "" }],
    type: "paragraph",
  }),
};

const captionText = (node: TElement): string => {
  const { caption } = node;
  return Array.isArray(caption)
    ? caption.map((part) => (NodeApi.isNode(part) ? NodeApi.string(part) : "")).join("")
    : "";
};

// an image on the web with no alt and no title reads back as the embed that wrote it; an alt or a
// title keeps it an image, so neither is ever dropped, and a picture in the folder is always one
const embedFromImage = (block: TElement): TElement => {
  const url = stringProp(block, "url");
  if (
    block.type !== KEYS.img ||
    url === undefined ||
    block.title !== undefined ||
    captionText(block) !== ""
  ) {
    return block;
  }
  const type = embedTypeForUrl(url);
  return type === null ? block : { children: [{ text: "" }], type, url };
};

const BARE_AUTOLINK_PROTOCOL_RE = /^https?:\/\//iu;
const WWW_AUTOLINK_RE = /^www\./iu;

// mirrors micromark-extension-gfm-autolink-literal's email tokenizer, so a match emitted as raw
// bytes re-parses as the same autolink.
const GFM_EMAIL_RE = /^[+\-.\w]+@(?=[^@]*\.[\dA-Za-z])(?:[-_\dA-Za-z]|\.(?=[\dA-Za-z]))*[A-Za-z]$/u;

const isMdText = (node: { type: string }): node is MdText => node.type === "text";

const TABLE_ALIGN = z.array(z.enum(["center", "left", "right"]).nullable());

const tableAlign = (node: TElement): AlignType[] | undefined => {
  const parsed = TABLE_ALIGN.safeParse(node.align);
  return parsed.success ? parsed.data : undefined;
};

// Slate pads inline elements with empty text siblings, and Plate's default p rule turns every
// empty text child into U+200B on serialize — ZWSPs around every chip after any live edit.
// Element-adjacent empties are normalization artifacts; a lone empty text (empty paragraph,
// ZWSP cell placeholder) is preserved.
const pruneElementAdjacentEmptyTexts = (children: Descendant[]): Descendant[] => {
  const pruned = children.filter((child, i) => {
    if (!TextApi.isText(child) || child.text !== "") {
      return true;
    }
    const prev = children[i - 1];
    const next = children[i + 1];
    return !(
      (prev !== undefined && ElementApi.isElement(prev)) ||
      (next !== undefined && ElementApi.isElement(next))
    );
  });
  return pruned.length > 0 ? pruned : children;
};

// Markdown has no empty inline math: `$$$$` re-parses as text and saves escaped, so an empty
// inline equation writes no bytes at all.
const isEmptyInlineEquation = (node: Descendant): boolean =>
  ElementApi.isElement(node) &&
  node.type === "inline_equation" &&
  (stringProp(node, "texExpression") ?? "") === "";

// what follows a `$$` on its line is the fence's meta to remark-math, and Plate's default drops it,
// though a person who opens with `$$ E = mc^2` wrote the expression's first line there
const equationRule: NonNullable<MdRules["equation"]> = {
  ...defaultEquation,
  deserialize: (node, deco, options) =>
    defaultEquationDeserialize(
      { ...node, value: (node.meta ?? "") === "" ? node.value : `${node.meta}\n${node.value}` },
      deco,
      options,
    ),
};

const inlineEquationRule: WideMdRule = {
  serialize: (node: TElement): MdInlineMath | undefined =>
    isEmptyInlineEquation(node)
      ? undefined
      : { type: "inlineMath", value: stringProp(node, "texExpression") ?? "" },
};

const prunedElement = (element: TElement): TElement => {
  const kept = pruneElementAdjacentEmptyTexts(element.children)
    .filter((child) => !isEmptyInlineEquation(child))
    .map((child) => (ElementApi.isElement(child) ? prunedElement(child) : child));
  return { ...element, children: kept.length > 0 ? kept : [{ text: "" }] };
};

// A pre-pass over the whole value rather than a paragraph rule's, since an empty equation sits in
// a heading or a list item as readily: it leaves before any text run is converted, so its
// neighbours join into one run rather than two whose marks collide (`**a****b**`), and an element
// it alone filled keeps an empty text instead of a blank line the next parse drops.
export const pruneForMarkdown = (value: Value): Value => value.map((block) => prunedElement(block));

const withoutEdgeBreak = (children: Descendant[], edge: "first" | "last"): Descendant[] => {
  const index = edge === "first" ? 0 : children.length - 1;
  const child = children[index];
  if (child === undefined || !TextApi.isText(child)) {
    return children;
  }
  const text = child.text.replace(edge === "first" ? /^\n/u : /\n$/u, "");
  return text === "" ? children.toSpliced(index, 1) : children.with(index, { ...child, text });
};

// Plate's p rule lifts an image out of its paragraph into a block of its own, answering several
// blocks where its type says one, and a lifted image an embed wrote reads back as that embed. A
// line break beside the image then sits at the edge of a paragraph around it, where it would save
// as a stray `\` line; the block boundary already ends the line, and a paragraph that held only
// that break goes.
const paragraphRule: WideMdRule = {
  deserialize: (
    node: MdParagraph,
    deco: MdDecoration,
    options: DeserializeMdOptions,
  ): TElement | TElement[] => {
    const converted: TElement | TElement[] = defaultParagraphDeserialize(node, deco, options);
    if (!ElementApi.isElementList(converted)) {
      return embedFromImage(converted);
    }
    return converted.flatMap((block, i): TElement[] => {
      if (block.type !== "p") {
        return [embedFromImage(block)];
      }
      const afterImage = i > 0 ? withoutEdgeBreak(block.children, "first") : block.children;
      const children = i < converted.length - 1 ? withoutEdgeBreak(afterImage, "last") : afterImage;
      return children.length > 0 ? [{ ...block, children }] : [];
    });
  },
  serialize: defaultParagraphSerialize,
};

// the blocks that are an item's own line: words, whichever block spelled them
const ITEM_LINES: ReadonlySet<string> = new Set([KEYS.p, ...KEYS.heading]);

const isItemLine = (block: TElement): boolean => ITEM_LINES.has(block.type);

const elementsIn = (nodes: readonly Descendant[]): TElement[] =>
  nodes.flatMap((node) => (ElementApi.isElement(node) ? [node] : []));

const emptyLine = (): TElement => ({ children: [{ text: "" }], type: KEYS.p });

// Plate's rule makes whatever an item opens with a `p`, an image aside, which keeps a text's words
// and leaves an embed's address, a fence's lines and a chart's source on a paragraph that holds
// none of them. Only words are an item here: any other block stands where the item stood, and the
// list writes it outside itself, with a to-do's box on a line of its own above it.
const listBlocks = (
  list: MdList,
  indent: number,
  deco: MdDecoration,
  options: DeserializeMdOptions,
): TElement[] => {
  const ordered = list.ordered === true;
  const first = list.start ?? 1;
  // a to-do turns the items after it into to-dos too: the flat list draws one style per run
  let listStyleType: string = ordered ? KEYS.ol : KEYS.ul;
  return list.children.flatMap((item, index): TElement[] => {
    const { checked } = item;
    const todo = checked !== null && checked !== undefined;
    if (todo) {
      listStyleType = KEYS.listTodo;
    }
    const [head, ...rest] = item.children;
    const opened =
      head === undefined
        ? [emptyLine()]
        : elementsIn(convertChildrenDeserialize([head], deco, options));
    const blocks = todo && !opened.some(isItemLine) ? [emptyLine(), ...opened] : opened;
    const number = first + index;
    const placed = blocks.map((block, at): TElement => {
      const element: TElement = {
        ...block,
        indent,
        listStyleType,
        type: isItemLine(block) ? KEYS.p : block.type,
      };
      if (todo) {
        element.checked = checked;
      }
      if (ordered) {
        element.listStart = number;
        if (index === 0 && at === 0 && number > 1) {
          element.listRestartPolite = number;
        }
      }
      return element;
    });
    const nested = rest.flatMap((child): TElement[] =>
      child.type === "list"
        ? listBlocks(child, indent + 1, deco, options)
        : elementsIn(convertChildrenDeserialize([child], deco, options)).map((block) => ({
            ...block,
            indent: indent + 1,
          })),
    );
    return [...placed, ...nested];
  });
};

const listRule: WideMdRule = {
  deserialize: (node: MdList, deco: MdDecoration, options: DeserializeMdOptions): TElement[] =>
    listBlocks(node, 1, deco, options),
};

// text a re-parse reads back as this same link: a bare url, a www literal (gfm prefixes its url
// with `http://`), or a gfm email
const isAutolinkText = (text: string, url: string): boolean =>
  (text === url && BARE_AUTOLINK_PROTOCOL_RE.test(url)) ||
  (url === `http://${text}` && WWW_AUTOLINK_RE.test(text)) ||
  (`mailto:${text}` === url && GFM_EMAIL_RE.test(text));

type MdMarkWrapper = MdDelete | MdEmphasis | MdStrong;

const isMdMarkWrapper = (node: { type: string }): node is MdMarkWrapper =>
  node.type === "emphasis" || node.type === "strong" || node.type === "delete";

// a mark over the whole link text converts to wrappers around its one text node, and the literal
// keeps them: `_https://x.cd_` re-parses as the same marked link.
const autolinkLiteral = (node: { type: string }, url: string): MDPhrasingContent | null => {
  if (isMdText(node)) {
    return isAutolinkText(node.value, url)
      ? ({ type: "opaqueInline", value: node.value } satisfies OpaqueInline)
      : null;
  }
  if (!isMdMarkWrapper(node)) {
    return null;
  }
  const [only, ...rest] = node.children;
  const inner = only === undefined || rest.length > 0 ? null : autolinkLiteral(only, url);
  return inner === null ? null : { ...node, children: [inner] };
};

// Plate's default lets mailto links reach mdast-util-to-markdown, whose formatLinkAsAutolink emits
// `<a@b.cd>`, the angle form MD_STRINGIFY's resourceLink bans. A link a re-parse would read from
// its literal bytes emits them; every other link stays `[text](url)` under resourceLink, which
// alone would also force bare https into resource form, a round trip's loss: a bare url would be
// saved back as `[url](url)`.
// The literal is an opaque inline, not `html`: mdast-util-to-markdown turns the line break before
// an html node into a space, since html opening a line could read as a flow block, and that joins
// a url on its own line to the line above.
// A title is words of the link's own, which Plate's default drops both ways and no literal can spell.
const linkRule: WideMdRule = {
  deserialize: (node: MdLink, deco: MdDecoration, options: DeserializeMdOptions): TElement => {
    const link = defaultLinkDeserialize(node, deco, options);
    const title = node.title ?? "";
    return title === "" ? link : { ...link, title };
  },
  serialize: (node: TLinkElement, options: SerializeMdOptions) => {
    const title = stringProp(node, "title");
    if (title !== undefined) {
      return { ...defaultLinkSerialize(node, options), title };
    }
    const [only, ...rest] = convertNodesSerialize(node.children, options);
    const literal = only === undefined || rest.length > 0 ? null : autolinkLiteral(only, node.url);
    return literal ?? defaultLinkSerialize(node, options);
  },
};

// an alert is still a blockquote to the serializer, which prefixes its lines, so a container
// keeps the blank line it leaves before a closing `:::` that a quote would read as its own line
const blockquoteRule: NonNullable<MdRules["blockquote"]> = {
  deserialize: defaultBlockquoteDeserialize,
  serialize: (node, options) => {
    const { editor } = options;
    // Plate keeps blockquote soft breaks as "\n" in text leaves, so the marker leads the concatenated text.
    if (!editor || leadingAlertMarker(NodeApi.string(node)) === null) {
      return defaultBlockquoteSerialize(node, options);
    }
    const children: Descendant[] = node.children;
    const inner = serializeMd(editor, {
      // break → "\n": alert continuation lines carry no trailing backslash.
      remarkStringifyOptions: {
        ...MD_STRINGIFY,
        handlers: { ...MD_STRINGIFY.handlers, break: () => "\n" },
      },
      value: children,
    })
      .trimEnd()
      // the nested pass escapes the marker's leading `[`.
      .replace(/^\\(?=\[!)/u, "");
    return { children: [{ type: "html", value: inner }], type: "blockquote" };
  },
};

// an item's article section, which no editor node holds: only the codec, which splits an item's
// sections before this table runs, builds the element, so an export writes the page a fill read
// inside `:::article` after the person's note
export const ARTICLE_SECTION_KEY = "article_section";

// a block's `ref` on its way between a note's markdown and the block: only the codec holds one,
// which is why it is no editor node, and it is off the line before anything stores it
export const BLOCK_REF_KEY = "blockRef";

// the editor holds no section, so a pasted `:::article` reads as the blocks inside it
const articleSectionRule: WideMdRule = {
  deserialize: (
    node: ArticleSection,
    deco: MdDecoration,
    options: DeserializeMdOptions,
  ): Descendant[] => convertChildrenDeserialize(node.children, deco, options),
};

// a `[[…]]` or `![[…]]` as the library's node, by the id its uuid alias names or the title as
// written; a node whose title no body can carry writes its words as text, which loses the link but
// never the words
const wikiRule = (type: WikiNodeType): WideMdRule => ({
  deserialize: (node: WikiLink | WikiEmbed): TElement => wikiNodeOfBody(type, node.body),
  serialize: (node: TElement): WikiLink | WikiEmbed | MdText => {
    const fields = wikiFieldsOf(node);
    const body = wikiBodyOf(fields);
    if (body === null) {
      return { type: "text", value: wikiLabelOf(fields) };
    }
    return type === WIKI_LINK_KEY ? { body, type: "wikiLink" } : { body, type: "wikiEmbed" };
  },
});

export const MD_RULES: MdRules = {
  a: linkRule,

  [ARTICLE_SECTION_KEY]: {
    serialize: (node: TElement, options: SerializeMdOptions): ArticleSection => ({
      children: containerFlow(node.children, options),
      type: "articleSection",
    }),
  },

  articleSection: articleSectionRule,

  [BLOCK_REF_KEY]: {
    deserialize: (node: BlockRef): TElement => ({
      children: [{ text: "" }],
      own: node.own,
      ref: node.ref,
      type: BLOCK_REF_KEY,
    }),
    serialize: (node: TElement): BlockRef => ({
      own: node.own === true,
      ref: stringProp(node, "ref") ?? "",
      type: "blockRef",
    }),
  },

  // remark-stringify escapes `[` at phrasing start, which would re-emit an alert marker as
  // `> \[!NOTE]`; an alert's body is serialized apart and quoted as one verbatim `html` block.
  blockquote: blockquoteRule,

  [CANVAS_BLOCK_KEY]: {
    serialize: (node: TElement): MdCode => ({
      lang: CANVAS_LANG,
      type: "code",
      value: stringProp(node, "value") ?? "",
    }),
  },

  [CHART_BLOCK_KEY]: {
    serialize: (node: TElement): MdCode => ({
      lang: CHART_LANG,
      type: "code",
      value: stringProp(node, "value") ?? "",
    }),
  },

  code_block: {
    deserialize: (node: MdCode, deco, options): TElement => {
      const richBlock = RICH_FENCE_LANGS.get(node.lang ?? "");
      if (richBlock !== undefined) {
        return { children: [{ text: "" }], type: richBlock, value: node.value };
      }
      return defaultCodeBlockDeserialize(node, deco, options);
    },
  },

  columnGroup: {
    deserialize: (node: ColumnGroup, deco, options): TElement => ({
      children: node.children.map((column): TElement => {
        const element: TElement = {
          children: ensureBlocks(convertChildrenDeserialize(column.children, deco, options)),
          type: KEYS.column,
        };
        if (column.width !== null) {
          element.width = column.width;
        }
        return element;
      }),
      type: KEYS.columnGroup,
    }),
  },

  // a column the editor holds outside a group saves as a group of one: a column has no spelling
  // of its own, and Plate's default would answer jsx
  column: {
    serialize: (node: TElement, options: SerializeMdOptions): ColumnGroup => ({
      children: [columnOf(node, options)],
      type: "columnGroup",
    }),
  },

  [KEYS.columnGroup]: {
    serialize: (node: TElement, options: SerializeMdOptions): ColumnGroup => ({
      children: node.children.flatMap((column): Column[] =>
        ElementApi.isElement(column) && column.type === KEYS.column
          ? [columnOf(column, options)]
          : [],
      ),
      type: "columnGroup",
    }),
  },

  [ANNOTATION_MARKER_KEY]: {
    deserialize: (node: AnnotationMarker): TElement => ({
      children: [{ text: "" }],
      edge: node.edge,
      ids: node.ids,
      type: ANNOTATION_MARKER_KEY,
    }),
    serialize: (node: TElement): AnnotationMarker => ({
      edge: node.edge === "end" ? "end" : "start",
      ids: stringProp(node, "ids") ?? "",
      type: "annotationMarker",
    }),
  },

  date: {
    deserialize: (node: DateChip): TElement => ({
      children: [{ text: "" }],
      date: node.value,
      type: KEYS.date,
    }),
    serialize: (node: TElement): DateChip => ({
      type: "date",
      value: stringProp(node, "date") ?? "",
    }),
  },

  file: embedRule,

  [FORMULA_PILL_KEY]: {
    deserialize: (node: FormulaPill): TElement => {
      const pill: TElement = {
        children: [{ text: "" }],
        display: node.display,
        source: node.source,
        type: FORMULA_PILL_KEY,
      };
      if (node.meta !== undefined && node.meta !== "") {
        pill.meta = node.meta;
      }
      return pill;
    },
    // the bytes are the pill's three parts, so no node holds a spelling of its own to drift
    serialize: (node: TElement): FormulaPill => {
      const raw = formulaRawOf({
        display: stringProp(node, "display") ?? "",
        meta: stringProp(node, "meta"),
        source: stringProp(node, "source") ?? "",
      });
      return { raw, type: "formulaPill", ...parseFormulaRaw(raw) };
    },
  },

  [HTML_BLOCK_KEY]: {
    serialize: (node: TElement): MdCode => ({
      lang: HTML_LANG,
      type: "code",
      value: stringProp(node, "value") ?? "",
    }),
  },

  equation: equationRule,

  inline_equation: inlineEquationRule,

  list: listRule,

  media_embed: embedRule,

  // what the dialect reads but no node models, its source written back as it came
  opaqueInline: {
    deserialize: (node: OpaqueInline): TElement => ({
      children: [{ text: "" }],
      source: node.value,
      type: OPAQUE_KEY,
    }),
  },

  [OPAQUE_KEY]: {
    serialize: (node: TElement): OpaqueInline => ({
      type: "opaqueInline",
      value: stringProp(node, "source") ?? "",
    }),
  },

  p: paragraphRule,

  tabGroup: {
    deserialize: (node: TabGroup, deco, options): TElement => ({
      children: node.children.map((panel): TElement => ({
        children: ensureBlocks(convertChildrenDeserialize(panel.children, deco, options)),
        label: panel.label,
        type: TAB_PANEL_KEY,
      })),
      type: TAB_GROUP_KEY,
    }),
  },

  [TAB_GROUP_KEY]: {
    serialize: (node: TElement, options: SerializeMdOptions): TabGroup => ({
      children: node.children.flatMap((panel): TabPanel[] => {
        if (!ElementApi.isElement(panel) || panel.type !== TAB_PANEL_KEY) {
          return [];
        }
        return [
          {
            children: containerFlow(panel.children, options),
            label: stringProp(panel, "label") ?? "Tab",
            type: "tabPanel",
          },
        ];
      }),
      type: "tabGroup",
    }),
  },

  // Plate's default drops a text node's leading "\n", so the "\n" its `<br>` rule yields is not
  // doubled; here `<br>` stays opaque and yields none, while a soft break after any inline node
  // (a chip, a pill, a mark, a link) arrives as exactly that leading "\n", and dropping it joins
  // the two lines.
  text: {
    deserialize: (node: MdText, deco: MdDecoration): TText => ({ ...deco, text: node.value }),
  },

  // Ragged rows are padded into real empty cells: mdast-util-gfm-table pads only in the emitted
  // string, so pass 1 writes empty cells that re-parse to ZWSP placeholders and the fixpoint
  // lands on pass 3. Plate's default drops mdast `align`, so a write would strip a `:-:`
  // delimiter row; align rides on the Slate node instead.
  table: {
    deserialize: (node, deco, options) => {
      const rows = node.children ?? [];
      const columns = Math.max(
        node.align?.length ?? 0,
        ...rows.map((row) => row.children.length),
        0,
      );
      const padRow = (row: MdTableRow): MdTableRow => {
        if (row.children.length >= columns) {
          return row;
        }
        const cells = [...row.children];
        while (cells.length < columns) {
          cells.push({ children: [], type: "tableCell" });
        }
        return { children: cells, type: "tableRow" };
      };
      const element = defaultTableDeserialize(
        { ...node, children: rows.map(padRow) },
        deco,
        options,
      );
      const align = node.align ?? [];
      return align.some((entry) => entry !== null) ? { ...element, align } : element;
    },
    serialize: (node, options) => {
      const table = defaultTableSerialize(node, options);
      const align = tableAlign(node);
      return align === undefined ? table : { ...table, align };
    },
  },

  // Plate maps `toggle` in its type table but ships no rule; without this a toggle silently drops on serialize.
  [KEYS.toggle]: {
    deserialize: (node: Toggle, deco: MdDecoration, options: DeserializeMdOptions): TElement => ({
      children: convertChildrenDeserialize(node.children, deco, options),
      type: KEYS.toggle,
    }),
    serialize: (node: TElement, options: SerializeMdOptions): Toggle => ({
      children: containerFlow(node.children, options),
      type: "toggle",
    }),
  },

  // Plate's own rule answers jsx, which the grammar never reads; the pair of tags it reads is this
  // node, whose children the mark serializer fills
  underline: {
    mark: true,
    serialize: (): Underline => ({ children: [], type: "underline" }),
  },

  video: embedRule,

  [WIKI_EMBED_KEY]: wikiRule(WIKI_EMBED_KEY),

  [WIKI_LINK_KEY]: wikiRule(WIKI_LINK_KEY),

  // Plate maps mdast `yaml` in its type table but ships no rule, so a fence with none is dropped.
  // Only a file has frontmatter, read off its mdast before this runs: a fence that opens a paste,
  // an agent's text or a page is that text's own lines.
  yaml: {
    deserialize: (node: MdYaml): TElement => yamlCodeBlock(node.value),
  },
};
