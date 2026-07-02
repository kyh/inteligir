// Wiki-link kit: inline-void nodes for [[target]] / [[target|alias]] /
// ![[embed]]. Node shape: { type, body, children:[{text:""}] } with `body`
// verbatim (round-trip contract lives in @repo/core/markdown/remark-wiki-link). The
// React half renders non-navigating chips (resolution/backlinks/autocomplete
// are Phase F) and adds the `]]` input rule: without it, typed `[[Note]]`
// would stay plain text and the serializer would escape it to `\[\[Note]]`
// on save — the flagship syntax would self-destruct.

import { KEYS, NodeApi, TextApi, createSlatePlugin, type SlateEditor } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import { insertVoidAndEscape } from "@repo/app/editor/insert-void";
import { parseWikiBody } from "@repo/core/markdown/remark-wiki-link";

const wikiLinkBasePlugin = createSlatePlugin({
  key: "wikiLink",
  node: { isElement: true, isInline: true, isVoid: true },
});

const wikiEmbedBasePlugin = createSlatePlugin({
  key: "wikiEmbed",
  node: { isElement: true, isInline: true, isVoid: true },
});

export const WikiLinkBaseKit = [wikiLinkBasePlugin, wikiEmbedBasePlugin];

// This keystroke's `]` completes `[[body]]` (the buffer already holds
// `[[body]`). Body excludes brackets/newlines and must be non-empty —
// mirroring the remark grammar, so the chip and the bytes agree.
const WIKI_COMPLETION_RE = /(!?)\[\[([^[\]\n]+)\]$/;

function chipLabel(body: unknown): string {
  const parsed = parseWikiBody(typeof body === "string" ? body : "");
  if (parsed.alias) return parsed.alias;
  return parsed.anchor ? `${parsed.target}#${parsed.anchor}` : parsed.target;
}

function WikiLinkElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="span" className="inline-block">
      <span
        contentEditable={false}
        title="Links resolve in a later phase"
        className="cursor-default rounded-sm bg-primary/10 px-1 text-primary/80"
      >
        {chipLabel(props.element.body)}
      </span>
      {props.children}
    </PlateElement>
  );
}

function WikiEmbedElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="span" className="inline-block">
      <span
        contentEditable={false}
        title="Embeds resolve in a later phase"
        className="cursor-default rounded-sm bg-primary/10 px-1 text-primary/80"
      >
        <span className={cn("mr-0.5 font-semibold select-none", "text-primary/50")}>!</span>
        {chipLabel(props.element.body)}
      </span>
      {props.children}
    </PlateElement>
  );
}

// On a `]` keystroke, if the text before the caret ends the `[[body]` form,
// replace the whole span with a wiki chip and swallow the `]`. Returns whether
// the completion fired.
function completeWikiChip(editor: SlateEditor): boolean {
  if (!editor.selection || !editor.api.isCollapsed()) return false;
  if (editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } })) return false;
  const { anchor } = editor.selection;
  const leaf = NodeApi.get(editor, anchor.path);
  if (!leaf || !TextApi.isText(leaf)) return false;
  const match = WIKI_COMPLETION_RE.exec(leaf.text.slice(0, anchor.offset));
  if (!match) return false;
  const full = match[0];
  const bang = match[1] ?? "";
  const body = match[2] ?? "";
  if (!body) return false;
  editor.tf.withoutNormalizing(() => {
    editor.tf.delete({
      at: {
        anchor: { offset: anchor.offset - full.length, path: anchor.path },
        focus: anchor,
      },
    });
  });
  // insertVoidAndEscape moves the caret past the chip — Slate would otherwise
  // park it inside the void's empty text and swallow subsequent keystrokes.
  insertVoidAndEscape(editor, {
    body,
    children: [{ text: "" }],
    type: bang ? "wikiEmbed" : "wikiLink",
  });
  return true;
}

export const WikiLinkKit = [
  wikiLinkBasePlugin
    .withComponent(WikiLinkElement)
    .overrideEditor(({ editor, tf: { insertText } }) => ({
      transforms: {
        // The `]]` completion rule (required by the Phase E spec).
        insertText(text, options) {
          if (text === "]" && completeWikiChip(editor)) return;
          insertText(text, options);
        },
      },
    })),
  wikiEmbedBasePlugin.withComponent(WikiEmbedElement),
];
