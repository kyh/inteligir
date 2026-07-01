// Custom markdown rules layered over @platejs/markdown's defaultRules. Free
// from defaults (do NOT redefine, only fixture-test): callout, column,
// column_group, date, equation, inline_equation, video/media_embed/file.
//
// Rule dispatch (verified against the installed dist): deserialize routes by
// mdast type (JSX elements by tag name), serialize by the Slate node's plugin
// key — hence the yaml/frontmatter split below: mdast `yaml` deserializes to a
// Slate `frontmatter` node, which serializes back under its own key.

import type { Descendant, TElement } from "platejs";
import {
  type DeserializeMdOptions,
  type MdDecoration,
  type MdMdxJsxFlowElement,
  type MdRules,
  type MdYaml,
  type SerializeMdOptions,
  convertChildrenDeserialize,
  convertNodesSerialize,
  defaultRules,
  parseAttributes,
  propsToAttributes,
  serializeMd,
} from "@platejs/markdown";

import { MD_STRINGIFY } from "@repo/app/editor/markdown/md-plugins";
import type { WikiEmbed, WikiLink } from "@repo/app/editor/markdown/remark-wiki-link";

// Fail fast if a @platejs/markdown bump reshapes defaultRules — the alert rule
// delegates every non-alert blockquote to the stock path.
const defaultBlockquote = defaultRules.blockquote;
const defaultBlockquoteDeserialize = defaultBlockquote?.deserialize;
const defaultBlockquoteSerialize = defaultBlockquote?.serialize;
if (!defaultBlockquoteDeserialize || !defaultBlockquoteSerialize) {
  throw new Error("@platejs/markdown defaultRules.blockquote is missing — pipeline cannot start");
}

const ALERT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/;

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

export const MD_RULES: MdRules = {
  // Plate maps `toggle` in its type table but ships NO rule — serializing a
  // toggle without this one silently DROPS the block (probe-proven).
  // Collapsed/open state lives in the toggle plugin's store (openIds), never on
  // the node, so a toggle serializes with zero attributes.
  toggle: {
    deserialize: (node: MdMdxJsxFlowElement, deco: MdDecoration, options: DeserializeMdOptions) => ({
      children: convertChildrenDeserialize(node.children, deco, options),
      type: "toggle",
      ...parseAttributes(node.attributes),
    }),
    serialize: (node: TElement, options: SerializeMdOptions) => {
      const { id, children, type, ...rest } = node;
      void id;
      void type;
      return {
        attributes: propsToAttributes(rest),
        children: convertNodesSerialize(children, options),
        name: "toggle",
        type: "mdxJsxFlowElement",
      };
    },
  },

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
        remarkStringifyOptions: { ...MD_STRINGIFY, handlers: { break: () => "\n" } },
      })
        .trimEnd()
        // The nested pass escapes the marker's leading `[` — undo just that.
        .replace(/^\\(?=\[!)/, "");
      const html = {
        type: "html",
        value: inner
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n"),
      };
      // Plate's MdRules narrows blockquote.serialize to return an mdast
      // blockquote, but the engine emits whatever node a rule returns (Plate's
      // own `a` defaultRule returns `html` for bare autolinks). Verbatim `html`
      // is the point here — bridge the over-narrow third-party type.
      // oxlint-disable-next-line typescript/consistent-type-assertions
      return html as unknown as ReturnType<typeof defaultBlockquoteSerialize>;
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
