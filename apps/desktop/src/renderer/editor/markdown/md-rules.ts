// Custom markdown rules layered over @platejs/markdown's defaultRules. Free
// from defaults (do NOT redefine, only fixture-test): column, column_group,
// date, equation, inline_equation. Wrapped-with-delegation (fixes layered on
// the stock behavior): a, table, blockquote; serialize-only id/src overrides:
// callout, video/media_embed/file.
//
// Rule dispatch (verified against the installed dist): deserialize routes by
// mdast type (JSX elements by tag name), serialize by the Slate node's plugin
// key — hence the yaml/frontmatter split below: mdast `yaml` deserializes to a
// Slate `frontmatter` node, which serializes back under its own key.

import type { AlignType } from "mdast";
import { ElementApi, TextApi, type Descendant, type TElement } from "platejs";
import {
  type DeserializeMdOptions,
  type MdDecoration,
  type MdMdxJsxFlowElement,
  type MdMdxJsxTextElement,
  type MdRules,
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

import { MD_STRINGIFY } from "@repo/core/markdown/md-plugins";
import type { WikiEmbed, WikiLink } from "@repo/core/markdown/remark-wiki-link";

// Fail fast if a @platejs/markdown bump reshapes defaultRules — the alert rule
// delegates every non-alert blockquote to the stock path, and the table rule
// wraps the stock table deserializer.
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

// Verbatim bytes: the stringifier emits a raw `html` node's value untouched,
// and the serialize engine emits whatever node a rule returns (Plate's own `a`
// defaultRule returns `html` for bare autolinks) — MdRules just over-narrows
// each rule's return type. The ONE sanctioned escape hatch bridging that
// over-narrow third-party type; `T` is the rule signature's demanded return.
function verbatimHtml<T>(value: string): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions
  return { type: "html", value } as unknown as T;
}

// Plate's NodeIdPlugin is a v53 core DEFAULT (disabled only under
// NODE_ENV=test): every block in a live editor carries an `id`. Plate's own
// column rules strip it before propsToAttributes, but its callout and media
// rules spread it — leaking `id="…"` junk into user files. These serialize
// overrides mirror the defaults minus the leak; deserialize is not overridden
// (rule dispatch falls back to the default per-function).
// Shared body of the four MDX-flow serialize rules below (media, toggle,
// column, callout): drop the leaked `id`, serialize children, emit an
// `mdxJsxFlowElement`. Overrides carry each rule's specifics — `name` defaults
// to the node's own type (media's video/media_embed/file), `mapProps` reshapes
// the leftover props before they become attributes (media's url→src), and
// `children` overrides the default child serialization (column's empty `[]`).
type JsxFlowOverrides = {
  name?: string;
  children?: ReturnType<typeof convertNodesSerialize>;
  mapProps?: (rest: Record<string, unknown>) => Record<string, unknown>;
};

function jsxFlowSerialize(
  node: TElement,
  options: SerializeMdOptions,
  overrides: JsxFlowOverrides,
) {
  const { id, children, type, ...rest } = node;
  void id;
  return {
    attributes: propsToAttributes(overrides.mapProps ? overrides.mapProps(rest) : rest),
    children: overrides.children ?? convertNodesSerialize(children, options),
    name: overrides.name ?? type,
    type: "mdxJsxFlowElement",
  };
}

function mediaSerializeWithoutId(node: TElement, options: SerializeMdOptions) {
  return jsxFlowSerialize(node, options, {
    // A url-less media node (`<video />`) must OMIT src entirely: spreading
    // `src: undefined` emits a bare `src` attribute, which the vocabulary scan
    // itself rejects on the next parse (non-string attr → Raw). `name` falls
    // back to the node's own type (video / media_embed / file).
    mapProps: (rest) => {
      const { url, ...props } = rest;
      return typeof url === "string" ? { ...props, src: url } : props;
    },
  });
}

// --- links -----------------------------------------------------------------

const BARE_AUTOLINK_PROTOCOL_RE = /^https?:\/\//i;

// Mirrors micromark-extension-gfm-autolink-literal's email tokenizer (lib/
// syntax.js): atext run, `@`, then a domain of [-_.alnum] that has content,
// contains a dot followed by an alphanumeric, and ends in a LETTER. A string
// matching this — emitted as raw bytes — is guaranteed to re-parse as the same
// gfm email autolink, so the literal form is byte-canonical for bare emails.
const GFM_EMAIL_RE = /^[+\-.\w]+@(?=[^@]*\.[\dA-Za-z])(?:[-_\dA-Za-z]|\.(?=[\dA-Za-z]))*[A-Za-z]$/;

// convertNodesSerialize returns loose unist nodes; narrow to an mdast text.
function isMdText(node: { type: string }): node is MdText {
  return node.type === "text";
}

// --- tables ------------------------------------------------------------------

// The mdast `align` array as it survives a trip through a Slate node prop.
function isAlignArray(value: unknown): value is AlignType[] {
  return (
    Array.isArray(value) &&
    value.every(
      (align) => align === null || align === "center" || align === "left" || align === "right",
    )
  );
}

// Concatenated text of a Slate subtree. Plate keeps blockquote soft breaks as
// "\n" inside text leaves, so this sees the alert marker on the first line.
function nodeText(node: unknown): string {
  if (node === null || typeof node !== "object") return "";
  if ("text" in node && typeof node.text === "string") return node.text;
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(nodeText).join("");
  }
  return "";
}

// Slate normalization pads inline elements with empty text siblings (a live
// editor's paragraph holding `[[a]]![[b]]` is [text"", wiki, text"", embed,
// text""]). Plate's default p rule converts EVERY empty text child to a
// zero-width space on serialize (its empty-PARAGRAPH preservation mechanism),
// which would sprinkle invisible ​ bytes around chips/dates in user
// files after any live edit. Element-adjacent empties are pure normalization
// artifacts — parse never produces them — so they're dropped before the
// default rule runs. A lone empty text (a genuinely empty paragraph, or the
// ZWSP table-cell placeholder) has no element neighbor and is preserved.
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

export const MD_RULES: MdRules = {
  // Serialize-only override of the default p rule (deserialize dispatch falls
  // back to the default): see pruneElementAdjacentEmptyTexts.
  p: {
    serialize: (node, options) =>
      defaultParagraphSerialize(
        { ...node, children: pruneElementAdjacentEmptyTexts(node.children) },
        options,
      ),
  },

  // Serialize-only override of Plate's `a` rule (deserialize dispatch falls
  // back to the default). Plate's default emits bare https literals as raw
  // bytes but lets mailto links reach mdast-util-to-markdown, whose
  // formatLinkAsAutolink turns them into `<a@b.cd>` — unparseable under MDX,
  // so a rich save would corrupt the file (worse: bare emails analyze as
  // richSafe). Bare gfm emails emit their literal bytes instead, which
  // re-parse as the same autolink; every remaining link stays `[text](url)`
  // (MD_STRINGIFY's resourceLink: true — a blanket resourceLink alone would
  // ALSO force bare-https literals into resource form, hence this rule).
  a: {
    serialize: (node, options) => {
      // The literal check mirrors the default rule's bare-link check: the
      // CONVERTED children must be a single plain text node (marks inside the
      // link text disqualify it) whose bytes are the address itself.
      const children = convertNodesSerialize(node.children, options);
      const url = typeof node.url === "string" ? node.url : "";
      const only = children.length === 1 ? children[0] : undefined;
      const text = only !== undefined && isMdText(only) ? only.value : null;
      const literal =
        text !== null &&
        ((text === url && BARE_AUTOLINK_PROTOCOL_RE.test(url)) ||
          (`mailto:${text}` === url && GFM_EMAIL_RE.test(text)));
      if (literal) {
        // Verbatim bytes — guaranteed by the regexes above to re-parse as the
        // same autolink (as with blockquote's alert emission).
        return verbatimHtml<ReturnType<typeof defaultLinkSerialize>>(text);
      }
      // Under MD_STRINGIFY's resourceLink: true the default skips its own
      // bare-https html path (hence the interception above) and every link
      // reaching the stringifier stays in resource form.
      return defaultLinkSerialize(node, options);
    },
  },

  // Plate maps `toggle` in its type table but ships NO rule — serializing a
  // toggle without this one silently DROPS the block (probe-proven).
  // Collapsed/open state lives in the toggle plugin's store (openIds), never on
  // the node, so a toggle serializes with zero attributes.
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

  // Serialize-only override of Plate's column rule. A column holding only an
  // empty paragraph — the live editor's shape for an empty column (the
  // insert seeds one; normalization keeps one) — must emit self-closed
  // `<column />`, the same bytes its parse produces. The default serializes
  // it as blank expanded content (`<column>\n\n  </column>`), which
  // re-parses to zero children and re-emits self-closed: a non-idempotent
  // first pass that knocked the file to Raw whenever an autosave landed
  // before every column had content.
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
      // Empty column ⇒ self-closed `<column />` (children: []); populated ⇒
      // default child serialization.
      return jsxFlowSerialize(node, options, {
        name: "column",
        ...(isEmpty ? { children: [] } : {}),
      });
    },
  },

  // Deserialize-only override of Plate's date rule (serialize dispatch falls
  // back to the default `<date value="…" />` emitter). A paragraph holding
  // ONLY a date chip serializes to `<date value="…" />` alone on its line —
  // bytes the NEXT parse classifies as a FLOW JSX element (micromark reads
  // any line-filling tag as flow). The default rule would return the inline
  // void at block level; wrapping it back into a paragraph restores the exact
  // shape that produced the bytes, so the form round-trips canonically.
  // vocabulary.ts admits flow `<date>` to match.
  date: {
    deserialize: (
      node: MdMdxJsxFlowElement | MdMdxJsxTextElement,
      deco: MdDecoration,
      options: DeserializeMdOptions,
    ): TElement => {
      const chip: TElement = defaultDateDeserialize(node, deco, options);
      if (node.type !== "mdxJsxFlowElement") return chip;
      // Empty-text padding mirrors Slate's normalized inline-void shape (the
      // p serialize rule prunes it back out, so bytes are unaffected).
      return { children: [{ text: "" }, chip, { text: "" }], type: "p" };
    },
  },

  // id-leak overrides (see mediaSerializeWithoutId).
  callout: {
    serialize: (node: TElement, options: SerializeMdOptions) =>
      jsxFlowSerialize(node, options, { name: "callout" }),
  },
  video: { serialize: mediaSerializeWithoutId },
  media_embed: { serialize: mediaSerializeWithoutId },
  file: { serialize: mediaSerializeWithoutId },

  // Inline-void wiki nodes; `body` stays verbatim both directions. The remark
  // plugin's toMarkdown handler emits the actual `[[…]]` / `![[…]]` bytes.
  wikiLink: {
    deserialize: (node: WikiLink): TElement => ({
      body: node.body,
      children: [{ text: "" }],
      type: "wikiLink",
    }),
    serialize: (node: TElement): WikiLink => ({
      body: typeof node.body === "string" ? node.body : "",
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
      body: typeof node.body === "string" ? node.body : "",
      type: "wikiEmbed",
    }),
  },

  // Wrapped default table rule, two fixes:
  // 1. Ragged rows are padded into REAL empty cells at deserialize.
  //    mdast-util-gfm-table pads short rows only in the emitted string (after
  //    rules ran), so pass 1 writes truly-empty `|   |` cells while a re-parse
  //    of that output turns them into empty paragraphs that serialize as the
  //    ZWSP placeholder — the document only reached its fixpoint on pass 3.
  //    Padding up front makes pass 1 emit the stable ZWSP-cell form directly.
  // 2. Column alignment survives. Plate's default rule drops mdast `align`,
  //    so a `:-:` delimiter row was silently stripped by a rich-mode save;
  //    the align array now rides on the Slate table node and is re-attached
  //    at serialize (mdast-util-gfm-table emits the delimiters from it).
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
      return isAlignArray(node.align) && node.align.some((align) => align !== null)
        ? { ...element, align: node.align }
        : element;
    },
    serialize: (node, options) => {
      const table = defaultTableSerialize(node, options);
      return isAlignArray(node.align) ? { ...table, align: node.align } : table;
    },
  },

  // GitHub-alert-aware blockquote. Alerts stay plain blockquotes in the model
  // (the renderer keys off the `[!TYPE]` text) — only serialization changes:
  // remark-stringify unconditionally escapes `[` at phrasing start, which would
  // re-emit the marker as `> \[!NOTE]`, so alerts emit as a raw `html` node
  // with self-managed `> ` prefixes. The body is produced by a nested
  // serializeMd pass so marks/math/wiki-links inside survive byte-exact; the
  // nested pass emits soft-break `break` nodes as plain newlines (handler
  // override) because GitHub alert continuation lines carry no trailing `\`.
  blockquote: {
    deserialize: defaultBlockquoteDeserialize,
    serialize: (node, options) => {
      const editor = options.editor;
      if (!editor || !ALERT_RE.test(nodeText(node))) {
        return defaultBlockquoteSerialize(node, options);
      }
      const children: Descendant[] = node.children;
      const inner = serializeMd(editor, {
        value: children,
        // Keep MD_STRINGIFY's handlers (doc-leading-hr guard — harmless here:
        // every line gets a `> ` prefix, so `---` can't land on byte 0 either
        // way) and add the soft-break override for alert continuation lines.
        remarkStringifyOptions: {
          ...MD_STRINGIFY,
          handlers: { ...MD_STRINGIFY.handlers, break: () => "\n" },
        },
      })
        .trimEnd()
        // The nested pass escapes the marker's leading `[` — undo just that.
        .replace(/^\\(?=\[!)/, "");
      // Verbatim `html` is the point here — self-managed `> ` prefixes the
      // stringifier must not touch.
      return verbatimHtml<ReturnType<typeof defaultBlockquoteSerialize>>(
        inner
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n"),
      );
    },
  },

  // Frontmatter: Plate maps mdast `yaml` in its type table but ships no rule —
  // parsed-then-dropped without this pair. The Slate node is a void element
  // pinned to path [0] by kits/frontmatter-kit.tsx (mdast-util-frontmatter
  // emits the `---` fence wherever the node sits, and a mid-document fence
  // re-parses as a thematic break — the position pin is what keeps idempotency).
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
      value: typeof node.value === "string" ? node.value : "",
    }),
  },
};
