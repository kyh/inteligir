// Wiki-link kit: inline-void nodes for [[target]] / [[target|alias]] /
// ![[embed]]. Node shape: { type, body, children:[{text:""}] } with `body`
// verbatim (round-trip contract lives in @repo/notes/markdown/remark-wiki-link).
// The React half renders navigating chips (wiki-chip.tsx) and transclusion
// cards (transclusion.tsx) — both behind React.lazy, because they reach into
// vault-context and an eager import from this file (which base-kit composes)
// would close an import cycle around the kit files. It also adds the `]]`
// input rule: without it, typed `[[Note]]` would stay plain text and the
// serializer would escape it to `\[\[Note]]` on save — the flagship syntax
// would self-destruct.

import { Suspense, lazy } from "react";
import { KEYS, NodeApi, TextApi, createSlatePlugin, type SlateEditor } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

const WikiChip = lazy(() => import("@repo/editor/wiki-chip"));
const Transclusion = lazy(() => import("@repo/editor/transclusion"));

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

// The pre-hydration fallback chip (also what a chip looks like while the lazy
// module streams in) — inert, but visually identical to a resolved chip.
function FallbackChip({ body, embed }: { body: unknown; embed?: boolean }) {
  return (
    <span
      contentEditable={false}
      className="cursor-default rounded-sm bg-primary/10 px-1 text-primary/80"
    >
      {embed === true && (
        <span className="mr-0.5 font-semibold text-primary/50 select-none">!</span>
      )}
      {chipLabel(body)}
    </span>
  );
}

function elementBody(element: PlateElementProps["element"]): string {
  return typeof element.body === "string" ? element.body : "";
}

function WikiLinkElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="span" className="inline-block">
      <span contentEditable={false}>
        <Suspense fallback={<FallbackChip body={props.element.body} />}>
          <WikiChip body={elementBody(props.element)} />
        </Suspense>
      </span>
      {props.children}
    </PlateElement>
  );
}

function WikiEmbedElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="span" className="inline-block w-full">
      <span contentEditable={false} className="block w-full">
        <Suspense fallback={<FallbackChip body={props.element.body} embed />}>
          <Transclusion body={elementBody(props.element)} />
        </Suspense>
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
        // The `]]` completion rule.
        insertText(text, options) {
          if (text === "]" && completeWikiChip(editor)) return;
          insertText(text, options);
        },
      },
    })),
  wikiEmbedBasePlugin.withComponent(WikiEmbedElement),
];
