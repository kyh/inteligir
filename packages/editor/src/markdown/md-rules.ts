// Rule dispatch: deserialize routes by mdast type (JSX by tag name), serialize by the Slate
// node's plugin key — hence the yaml/frontmatter split.

import type { AlignType } from "mdast";
import { ElementApi, KEYS, NodeApi, TextApi } from "platejs";
import type { Descendant, TElement, TLinkElement, TText, Value } from "platejs";
import {
  convertChildrenDeserialize,
  convertNodesSerialize,
  defaultRules,
  parseAttributes,
  propsToAttributes,
  serializeMd,
} from "@platejs/markdown";
import type {
  DeserializeMdOptions,
  MDPhrasingContent,
  MdDecoration,
  MdDelete,
  MdEmphasis,
  MdStrong,
  MdMdxJsxFlowElement,
  MdMdxJsxTextElement,
  MdRules,
  MdCode,
  MdInlineMath,
  MdParagraph,
  MdTableRow,
  MdText,
  MdYaml,
  SerializeMdOptions,
} from "@platejs/markdown";
import { z } from "zod";

import { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";
import { parseCalloutPayload } from "@repo/notes/markdown/callout-payload";
import { parseMdast } from "@repo/notes/markdown/parse";
import type { OpaqueBlock, OpaqueInline } from "@repo/notes/markdown/remark-opaque";
import { parseFormulaRaw } from "@repo/notes/markdown/remark-inline-constructs";
import type { CommentMarker, FormulaPill } from "@repo/notes/markdown/remark-inline-constructs";
import type { TabPanel, TabGroup } from "@repo/notes/markdown/remark-tabs";
import {
  CANVAS_LANG,
  CHART_LANG,
  COMPAT_CALLOUT_LANG,
  HTML_LANG,
  isCalloutLang,
  RICH_FENCE_LANGS,
} from "@repo/notes/markdown/fence-langs";
import type { WikiEmbed, WikiLink } from "@repo/notes/markdown/remark-wiki-link";

import {
  CANVAS_BLOCK_KEY,
  CHART_BLOCK_KEY,
  COMMENT_MARKER_KEY,
  FORMULA_PILL_KEY,
  FRONTMATTER_KEY,
  HTML_BLOCK_KEY,
  OPAQUE_BLOCK_KEY,
  OPAQUE_INLINE_KEY,
  TAB_GROUP_KEY,
  TAB_PANEL_KEY,
  WIKI_EMBED_KEY,
  WIKI_LINK_KEY,
} from "@repo/editor/dialect-node-keys";
import { leadingAlertMarker } from "@repo/editor/markdown/alert-marker";
import { stringProp } from "@repo/editor/node-props";

const isPanelContent = (
  node: TabPanel["children"][number] | { type: string },
): node is TabPanel["children"][number] =>
  node.type !== "yaml" && node.type !== "tabGroup" && node.type !== "tabPanel";

const ensureBlocks = (children: Descendant[]): Descendant[] =>
  children.length > 0 ? children : [{ children: [{ text: "" }], type: "p" }];

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
const defaultLinkSerialize = defaultRules.a?.serialize;
if (!defaultLinkSerialize) {
  throw new Error("@platejs/markdown defaultRules.a is missing — pipeline cannot start");
}
const defaultDateDeserialize = defaultRules.date?.deserialize;
if (!defaultDateDeserialize) {
  throw new Error("@platejs/markdown defaultRules.date is missing — pipeline cannot start");
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

// NodeIdPlugin is a core default (off only under NODE_ENV=test), so every live block carries an
// `id`; Plate's callout and media rules spread it into user files as `id="…"`. The node's key
// order is the emitted attribute order.
interface JsxFlowOverrides {
  name?: string;
  children?: ReturnType<typeof convertNodesSerialize>;
}

const jsxFlowSerialize = (
  node: TElement,
  options: SerializeMdOptions,
  overrides: JsxFlowOverrides,
) => {
  const { id, children, type, ...rest } = node;
  void id;
  return {
    attributes: propsToAttributes(rest),
    children: overrides.children ?? convertNodesSerialize(children, options),
    name: overrides.name ?? type,
    type: "mdxJsxFlowElement",
  };
};

// A url-less node must omit src: spreading `src: undefined` emits a bare `src` attribute, which
// the next parse turns opaque. `src` goes at the end of the prop order, where propsToAttributes reads it.
const mediaSerializeWithoutId = (node: TElement, options: SerializeMdOptions) => {
  const { url, ...withoutUrl } = node;
  void url;
  const src = stringProp(node, "url");
  const media: TElement = src === undefined ? withoutUrl : { ...withoutUrl, src };
  return jsxFlowSerialize(media, options, {});
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

// An edit replaces the top-level blocks it touched and keeps every other by identity, so a save
// prunes only those.
const prunedByBlock = new WeakMap<TElement, TElement>();

const prunedBlock = (block: TElement): TElement => {
  const cached = prunedByBlock.get(block);
  if (cached !== undefined) {
    return cached;
  }
  const pruned = prunedElement(block);
  prunedByBlock.set(block, pruned);
  return pruned;
};

// A pre-pass over the whole value rather than a paragraph rule's, since an empty equation sits in
// a heading or a list item as readily: it leaves before any text run is converted, so its
// neighbours join into one run rather than two whose marks collide (`**a****b**`), and an element
// it alone filled keeps an empty text instead of a blank line the next parse drops.
export const pruneForMarkdown = (value: Value): Value => value.map(prunedBlock);

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
// blocks where its type says one. A line break beside the image then sits at the edge of a
// paragraph around it, where it would save as a stray `\` line; the block boundary already ends
// the line, and a paragraph that held only that break goes.
const paragraphRule: WideMdRule = {
  deserialize: (
    node: MdParagraph,
    deco: MdDecoration,
    options: DeserializeMdOptions,
  ): TElement | TElement[] => {
    const converted: TElement | TElement[] = defaultParagraphDeserialize(node, deco, options);
    if (!Array.isArray(converted)) {
      return converted;
    }
    return converted.flatMap((block, i): TElement[] => {
      if (block.type !== "p") {
        return [block];
      }
      const afterImage = i > 0 ? withoutEdgeBreak(block.children, "first") : block.children;
      const children = i < converted.length - 1 ? withoutEdgeBreak(afterImage, "last") : afterImage;
      return children.length > 0 ? [{ ...block, children }] : [];
    });
  },
  serialize: defaultParagraphSerialize,
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
// `<a@b.cd>` — unparseable under MDX. A link a re-parse would read from its literal bytes emits
// them; every other link stays `[text](url)` under MD_STRINGIFY's resourceLink, which alone would
// also force bare https into resource form, and a note holding one would open Raw.
// The literal is an opaque inline, not `html`: mdast-util-to-markdown turns the line break before
// an html node into a space, since html opening a line could read as a flow block, and that joins
// a url on its own line to the line above.
const linkRule: WideMdRule = {
  serialize: (node: TLinkElement, options: SerializeMdOptions) => {
    const [only, ...rest] = convertNodesSerialize(node.children, options);
    const literal = only === undefined || rest.length > 0 ? null : autolinkLiteral(only, node.url);
    return literal ?? defaultLinkSerialize(node, options);
  },
};

const blockquoteRule: WideMdRule = {
  deserialize: defaultBlockquoteDeserialize,
  serialize: (node: TElement, options: SerializeMdOptions) => {
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
    return {
      type: "html",
      value: inner
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n"),
    };
  },
};

export const MD_RULES: MdRules = {
  a: linkRule,

  // remark-stringify escapes `[` at phrasing start, which would re-emit an alert marker as
  // `> \[!NOTE]`; alerts emit as a raw `html` node with self-managed `> ` prefixes.
  blockquote: blockquoteRule,

  // the body round-trips through the same pipeline so inline constructs inside survive byte-exact.
  [KEYS.callout]: {
    serialize: (node: TElement, options: SerializeMdOptions): MdCode => {
      const { editor } = options;
      const variant = stringProp(node, "variant") ?? "info";
      const typeLine = node.typePrefixed === true ? `type: ${variant}` : variant;
      const levelValue = stringProp(node, "level") ?? "";
      const level =
        levelValue === ""
          ? []
          : [node.levelPrefixed === true ? `level: ${levelValue}` : levelValue];
      const children: Descendant[] = node.children;
      const body =
        editor === undefined
          ? ""
          : serializeMd(editor, {
              remarkStringifyOptions: MD_STRINGIFY,
              value: children,
            }).replace(/\n$/u, "");
      return {
        lang: COMPAT_CALLOUT_LANG,
        type: "code",
        value: [typeLine, ...level, ...(body === "" ? [] : [body])].join("\n"),
      };
    },
  },

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
      if (isCalloutLang(node.lang)) {
        const payload = parseCalloutPayload(node.value);
        if (payload === null) {
          return defaultCodeBlockDeserialize(node, deco, options);
        }
        const parsed = parseMdast(payload.body);
        const children: Descendant[] = parsed.ok
          ? convertChildrenDeserialize(parsed.root.children, deco, options)
          : [{ children: [{ text: payload.body }], type: "p" }];
        // a prefix prop is set only when the note wrote one; a false prop would replay a spelling it never had.
        const callout: TElement = {
          children: children.length > 0 ? children : [{ children: [{ text: "" }], type: "p" }],
          type: KEYS.callout,
          variant: payload.kind,
        };
        if (payload.typePrefixed) {
          callout.typePrefixed = true;
        }
        if (payload.level !== undefined) {
          callout.level = payload.level;
          if (payload.levelPrefixed) {
            callout.levelPrefixed = true;
          }
        }
        return callout;
      }
      const richBlock = RICH_FENCE_LANGS.get(node.lang ?? "");
      if (richBlock !== undefined) {
        // a legacy spelling lands on the same node and re-emits as ours, canonicalizing on first save.
        return { children: [{ text: "" }], type: richBlock, value: node.value };
      }
      return defaultCodeBlockDeserialize(node, deco, options);
    },
  },

  // An empty column must emit self-closed `<column />`: the default emits expanded blank content
  // that re-parses to zero children and re-emits self-closed — a non-idempotent first pass that
  // knocks the file to Raw on autosave.
  column: {
    serialize: (node: TElement, options: SerializeMdOptions) => {
      const { children } = node;
      const only = children.length === 1 ? children[0] : undefined;
      const onlyText =
        only !== undefined &&
        ElementApi.isElement(only) &&
        only.type === "p" &&
        only.children.length === 1
          ? only.children[0]
          : undefined;
      const isEmpty = onlyText !== undefined && TextApi.isText(onlyText) && onlyText.text === "";
      const overrides: JsxFlowOverrides = { name: "column" };
      if (isEmpty) {
        overrides.children = [];
      }
      return jsxFlowSerialize(node, options, overrides);
    },
  },

  [COMMENT_MARKER_KEY]: {
    deserialize: (node: CommentMarker): TElement => ({
      children: [{ text: "" }],
      edge: node.edge,
      ids: node.ids,
      type: COMMENT_MARKER_KEY,
    }),
    serialize: (node: TElement): CommentMarker => ({
      edge: node.edge === "end" ? "end" : "start",
      ids: stringProp(node, "ids") ?? "",
      type: "commentMarker",
    }),
  },

  // A paragraph holding only a date chip serializes to `<date value="…" />` alone on its line,
  // which micromark re-parses as a flow element; wrapping it back into a paragraph restores the
  // shape that produced the bytes.
  date: {
    deserialize: (
      node: MdMdxJsxFlowElement | MdMdxJsxTextElement,
      deco: MdDecoration,
      options: DeserializeMdOptions,
    ): TElement => {
      const chip: TElement = defaultDateDeserialize(node, deco, options);
      if (node.type !== "mdxJsxFlowElement") {
        return chip;
      }
      // the padding mirrors Slate's inline-void shape; the p rule prunes it on serialize.
      return { children: [{ text: "" }, chip, { text: "" }], type: "p" };
    },
  },

  file: { serialize: mediaSerializeWithoutId },

  [FORMULA_PILL_KEY]: {
    deserialize: (node: FormulaPill): TElement => ({
      children: [{ text: "" }],
      display: node.display,
      meta: node.meta ?? "",
      raw: node.raw,
      source: node.source,
      type: FORMULA_PILL_KEY,
    }),
    serialize: (node: TElement): FormulaPill => {
      const raw = stringProp(node, "raw") ?? "";
      return { raw, type: "formulaPill", ...parseFormulaRaw(raw) };
    },
  },

  [FRONTMATTER_KEY]: {
    serialize: (node: TElement): MdYaml => ({
      type: "yaml",
      value: stringProp(node, "value") ?? "",
    }),
  },

  [HTML_BLOCK_KEY]: {
    serialize: (node: TElement): MdCode => ({
      lang: HTML_LANG,
      type: "code",
      value: stringProp(node, "value") ?? "",
    }),
  },

  inline_equation: inlineEquationRule,

  media_embed: { serialize: mediaSerializeWithoutId },

  [OPAQUE_BLOCK_KEY]: {
    deserialize: (node: OpaqueBlock): TElement => ({
      children: [{ text: "" }],
      type: OPAQUE_BLOCK_KEY,
      value: node.value,
    }),
    serialize: (node: TElement): OpaqueBlock => ({
      type: "opaqueBlock",
      value: stringProp(node, "value") ?? "",
    }),
  },

  [OPAQUE_INLINE_KEY]: {
    deserialize: (node: OpaqueInline): TElement => ({
      children: [{ text: "" }],
      type: OPAQUE_INLINE_KEY,
      value: node.value,
    }),
    serialize: (node: TElement): OpaqueInline => ({
      type: "opaqueInline",
      value: stringProp(node, "value") ?? "",
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
        const panelChildren = convertNodesSerialize(panel.children, options).flatMap(
          (child): TabPanel["children"] => (isPanelContent(child) ? [child] : []),
        );
        return [
          {
            children: panelChildren,
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
  // lands on pass 3. Plate's default drops mdast `align`, so a rich save would strip a `:-:`
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
    deserialize: (
      node: MdMdxJsxFlowElement,
      deco: MdDecoration,
      options: DeserializeMdOptions,
    ) => ({
      children: convertChildrenDeserialize(node.children, deco, options),
      type: KEYS.toggle,
      ...parseAttributes(node.attributes),
    }),
    serialize: (node: TElement, options: SerializeMdOptions) =>
      jsxFlowSerialize(node, options, { name: "toggle" }),
  },

  video: { serialize: mediaSerializeWithoutId },

  [WIKI_EMBED_KEY]: {
    deserialize: (node: WikiEmbed): TElement => ({
      body: node.body,
      children: [{ text: "" }],
      type: WIKI_EMBED_KEY,
    }),
    serialize: (node: TElement): WikiEmbed => ({
      body: stringProp(node, "body") ?? "",
      type: "wikiEmbed",
    }),
  },

  [WIKI_LINK_KEY]: {
    deserialize: (node: WikiLink): TElement => ({
      body: node.body,
      children: [{ text: "" }],
      type: WIKI_LINK_KEY,
    }),
    serialize: (node: TElement): WikiLink => ({
      body: stringProp(node, "body") ?? "",
      type: "wikiLink",
    }),
  },

  // Plate maps mdast `yaml` in its type table but ships no rule; without this and the
  // `frontmatter` serialize rule above, frontmatter is parsed then dropped.
  yaml: {
    deserialize: (node: MdYaml): TElement => ({
      children: [{ text: "" }],
      type: FRONTMATTER_KEY,
      value: node.value,
    }),
  },
};
