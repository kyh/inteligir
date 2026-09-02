// Rule dispatch: deserialize routes by mdast type (JSX by tag name), serialize by the Slate
// node's plugin key — hence the yaml/frontmatter split.

import type { AlignType } from "mdast";
import {
  ElementApi,
  NodeApi,
  TextApi,
  type Descendant,
  type TElement,
  type TLinkElement,
} from "platejs";
import {
  type DeserializeMdOptions,
  type MdDecoration,
  type MdMdxJsxFlowElement,
  type MdMdxJsxTextElement,
  type MdRules,
  type MdCode,
  type MdTableRow,
  type MdText,
  type MdYaml,
  type SerializeMdOptions,
  convertChildrenDeserialize,
  convertNodesSerialize,
  defaultRules,
  parseAttributes,
  propsToAttributes,
  serializeMd,
} from "@platejs/markdown";
import { z } from "zod";

import { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";
import { parseCalloutPayload } from "@repo/notes/markdown/callout-payload";
import { parseMdast } from "@repo/notes/markdown/parse";
import type { OpaqueBlock, OpaqueInline } from "@repo/notes/markdown/remark-opaque";
import {
  parseFormulaRaw,
  type CommentMarker,
  type FormulaPill,
} from "@repo/notes/markdown/remark-inline-constructs";
import type { TabPanel, TabGroup } from "@repo/notes/markdown/remark-tabs";
import {
  CALLOUT_LANG,
  CANVAS_LANG,
  CHART_LANG,
  HTML_LANG,
  isCalloutLang,
  RICH_FENCE_LANGS,
} from "@repo/notes/markdown/fence-langs";
import type { WikiEmbed, WikiLink } from "@repo/notes/markdown/remark-wiki-link";

import { stringProp } from "@repo/editor/node-props";

function isPanelContent(
  node: TabPanel["children"][number] | { type: string },
): node is TabPanel["children"][number] {
  return node.type !== "yaml" && node.type !== "tabGroup" && node.type !== "tabPanel";
}

function ensureBlocks(children: Descendant[]): Descendant[] {
  return children.length > 0 ? children : [{ children: [{ text: "" }], type: "p" }];
}

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
const defaultParagraphSerialize = defaultRules.p?.serialize;
if (!defaultParagraphSerialize) {
  throw new Error("@platejs/markdown defaultRules.p is missing — pipeline cannot start");
}

const ALERT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/;

// `MdRules` narrows each keyed rule's return to that key's mdast node; rules emitting verbatim
// bytes as a raw `html` node are declared against the index signature's wide serialize instead of casting.
type WideMdRule = NonNullable<MdRules[string]>;

// NodeIdPlugin is a core default (off only under NODE_ENV=test), so every live block carries an
// `id`; Plate's callout and media rules spread it into user files as `id="…"`. The node's key
// order is the emitted attribute order.
type JsxFlowOverrides = {
  name?: string;
  children?: ReturnType<typeof convertNodesSerialize>;
};

function jsxFlowSerialize(
  node: TElement,
  options: SerializeMdOptions,
  overrides: JsxFlowOverrides,
) {
  const { id, children, type, ...rest } = node;
  void id;
  return {
    attributes: propsToAttributes(rest),
    children: overrides.children ?? convertNodesSerialize(children, options),
    name: overrides.name ?? type,
    type: "mdxJsxFlowElement",
  };
}

// A url-less node must omit src: spreading `src: undefined` emits a bare `src` attribute, which
// the next parse turns opaque. `src` goes at the end of the prop order, where propsToAttributes reads it.
function mediaSerializeWithoutId(node: TElement, options: SerializeMdOptions) {
  const { url, ...withoutUrl } = node;
  void url;
  const src = stringProp(node, "url");
  const media: TElement = src === undefined ? withoutUrl : { ...withoutUrl, src };
  return jsxFlowSerialize(media, options, {});
}

const BARE_AUTOLINK_PROTOCOL_RE = /^https?:\/\//i;

// mirrors micromark-extension-gfm-autolink-literal's email tokenizer, so a match emitted as raw
// bytes re-parses as the same autolink.
const GFM_EMAIL_RE = /^[+\-.\w]+@(?=[^@]*\.[\dA-Za-z])(?:[-_\dA-Za-z]|\.(?=[\dA-Za-z]))*[A-Za-z]$/;

function isMdText(node: { type: string }): node is MdText {
  return node.type === "text";
}

const TABLE_ALIGN = z.array(z.enum(["center", "left", "right"]).nullable());

function tableAlign(node: TElement): AlignType[] | undefined {
  const parsed = TABLE_ALIGN.safeParse(node.align);
  return parsed.success ? parsed.data : undefined;
}

// Slate pads inline elements with empty text siblings, and Plate's default p rule turns every
// empty text child into U+200B on serialize — ZWSPs around every chip after any live edit.
// Element-adjacent empties are normalization artifacts; a lone empty text (empty paragraph,
// ZWSP cell placeholder) is preserved.
function pruneElementAdjacentEmptyTexts(children: Descendant[]): Descendant[] {
  const pruned = children.filter((child, i) => {
    if (!TextApi.isText(child) || child.text !== "") return true;
    const prev = children[i - 1];
    const next = children[i + 1];
    return !(
      (prev !== undefined && ElementApi.isElement(prev)) ||
      (next !== undefined && ElementApi.isElement(next))
    );
  });
  return pruned.length > 0 ? pruned : children;
}

// Plate's default lets mailto links reach mdast-util-to-markdown, whose formatLinkAsAutolink emits
// `<a@b.cd>` — unparseable under MDX. Bare gfm emails emit their literal bytes; every other link
// stays `[text](url)` under MD_STRINGIFY's resourceLink, which alone would also force bare https into resource form.
const linkRule: WideMdRule = {
  serialize: (node: TLinkElement, options: SerializeMdOptions) => {
    const children = convertNodesSerialize(node.children, options);
    const url = node.url;
    const only = children.length === 1 ? children[0] : undefined;
    const text = only !== undefined && isMdText(only) ? only.value : null;
    const literal =
      text !== null &&
      ((text === url && BARE_AUTOLINK_PROTOCOL_RE.test(url)) ||
        (`mailto:${text}` === url && GFM_EMAIL_RE.test(text)));
    if (literal) {
      return { type: "html", value: text };
    }
    return defaultLinkSerialize(node, options);
  },
};

const blockquoteRule: WideMdRule = {
  deserialize: defaultBlockquoteDeserialize,
  serialize: (node: TElement, options: SerializeMdOptions) => {
    const editor = options.editor;
    // Plate keeps blockquote soft breaks as "\n" in text leaves, so the marker leads the concatenated text.
    if (!editor || !ALERT_RE.test(NodeApi.string(node))) {
      return defaultBlockquoteSerialize(node, options);
    }
    const children: Descendant[] = node.children;
    const inner = serializeMd(editor, {
      value: children,
      // break → "\n": alert continuation lines carry no trailing backslash.
      remarkStringifyOptions: {
        ...MD_STRINGIFY,
        handlers: { ...MD_STRINGIFY.handlers, break: () => "\n" },
      },
    })
      .trimEnd()
      // the nested pass escapes the marker's leading `[`.
      .replace(/^\\(?=\[!)/, "");
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
  p: {
    serialize: (node, options) =>
      defaultParagraphSerialize(
        { ...node, children: pruneElementAdjacentEmptyTexts(node.children) },
        options,
      ),
  },

  a: linkRule,

  // Plate maps `toggle` in its type table but ships no rule; without this a toggle silently drops on serialize.
  toggle: {
    deserialize: (
      node: MdMdxJsxFlowElement,
      deco: MdDecoration,
      options: DeserializeMdOptions,
    ) => ({
      children: convertChildrenDeserialize(node.children, deco, options),
      type: "toggle",
      ...parseAttributes(node.attributes),
    }),
    serialize: (node: TElement, options: SerializeMdOptions) =>
      jsxFlowSerialize(node, options, { name: "toggle" }),
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
      if (isEmpty) overrides.children = [];
      return jsxFlowSerialize(node, options, overrides);
    },
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
      if (node.type !== "mdxJsxFlowElement") return chip;
      // the padding mirrors Slate's inline-void shape; the p rule prunes it on serialize.
      return { children: [{ text: "" }, chip, { text: "" }], type: "p" };
    },
  },

  // the body round-trips through the same pipeline so inline constructs inside survive byte-exact.
  callout: {
    serialize: (node: TElement, options: SerializeMdOptions): MdCode => {
      const editor = options.editor;
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
            }).replace(/\n$/, "");
      return {
        lang: CALLOUT_LANG,
        type: "code",
        value: [typeLine, ...level, ...(body === "" ? [] : [body])].join("\n"),
      };
    },
  },
  video: { serialize: mediaSerializeWithoutId },
  media_embed: { serialize: mediaSerializeWithoutId },
  file: { serialize: mediaSerializeWithoutId },

  opaqueBlock: {
    deserialize: (node: OpaqueBlock): TElement => ({
      children: [{ text: "" }],
      type: "opaqueBlock",
      value: node.value,
    }),
    serialize: (node: TElement): OpaqueBlock => ({
      type: "opaqueBlock",
      value: stringProp(node, "value") ?? "",
    }),
  },
  opaqueInline: {
    deserialize: (node: OpaqueInline): TElement => ({
      children: [{ text: "" }],
      type: "opaqueInline",
      value: node.value,
    }),
    serialize: (node: TElement): OpaqueInline => ({
      type: "opaqueInline",
      value: stringProp(node, "value") ?? "",
    }),
  },

  wikiLink: {
    deserialize: (node: WikiLink): TElement => ({
      body: node.body,
      children: [{ text: "" }],
      type: "wikiLink",
    }),
    serialize: (node: TElement): WikiLink => ({
      body: stringProp(node, "body") ?? "",
      type: "wikiLink",
    }),
  },
  wikiEmbed: {
    deserialize: (node: WikiEmbed): TElement => ({
      body: node.body,
      children: [{ text: "" }],
      type: "wikiEmbed",
    }),
    serialize: (node: TElement): WikiEmbed => ({
      body: stringProp(node, "body") ?? "",
      type: "wikiEmbed",
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
          type: "callout",
          variant: payload.kind,
        };
        if (payload.typePrefixed) callout.typePrefixed = true;
        if (payload.level !== undefined) {
          callout.level = payload.level;
          if (payload.levelPrefixed) callout.levelPrefixed = true;
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

  chart_block: {
    serialize: (node: TElement): MdCode => ({
      lang: CHART_LANG,
      type: "code",
      value: stringProp(node, "value") ?? "",
    }),
  },
  canvas_block: {
    serialize: (node: TElement): MdCode => ({
      lang: CANVAS_LANG,
      type: "code",
      value: stringProp(node, "value") ?? "",
    }),
  },
  html_block: {
    serialize: (node: TElement): MdCode => ({
      lang: HTML_LANG,
      type: "code",
      value: stringProp(node, "value") ?? "",
    }),
  },

  tabGroup: {
    deserialize: (node: TabGroup, deco, options): TElement => ({
      children: node.children.map((panel): TElement => ({
        children: ensureBlocks(convertChildrenDeserialize(panel.children, deco, options)),
        label: panel.label,
        type: "tab_panel",
      })),
      type: "tab_group",
    }),
  },
  tab_group: {
    serialize: (node: TElement, options: SerializeMdOptions): TabGroup => ({
      children: node.children.flatMap((panel): TabPanel[] => {
        if (!ElementApi.isElement(panel) || panel.type !== "tab_panel") return [];
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

  formulaPill: {
    deserialize: (node: FormulaPill): TElement => ({
      children: [{ text: "" }],
      display: node.display,
      meta: node.meta ?? "",
      raw: node.raw,
      source: node.source,
      type: "formulaPill",
    }),
    serialize: (node: TElement): FormulaPill => {
      const raw = stringProp(node, "raw") ?? "";
      return { raw, type: "formulaPill", ...parseFormulaRaw(raw) };
    },
  },
  commentMarker: {
    deserialize: (node: CommentMarker): TElement => ({
      children: [{ text: "" }],
      edge: node.edge,
      ids: node.ids,
      type: "commentMarker",
    }),
    serialize: (node: TElement): CommentMarker => ({
      edge: node.edge === "end" ? "end" : "start",
      ids: stringProp(node, "ids") ?? "",
      type: "commentMarker",
    }),
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
        if (row.children.length >= columns) return row;
        const cells = [...row.children];
        while (cells.length < columns) cells.push({ children: [], type: "tableCell" });
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

  // remark-stringify escapes `[` at phrasing start, which would re-emit an alert marker as
  // `> \[!NOTE]`; alerts emit as a raw `html` node with self-managed `> ` prefixes.
  blockquote: blockquoteRule,

  // Plate maps mdast `yaml` in its type table but ships no rule; parsed-then-dropped without this pair.
  yaml: {
    deserialize: (node: MdYaml): TElement => ({
      children: [{ text: "" }],
      type: "frontmatter",
      value: node.value,
    }),
  },
  frontmatter: {
    serialize: (node: TElement): MdYaml => ({
      type: "yaml",
      value: stringProp(node, "value") ?? "",
    }),
  },
};
