// WikiChip and Transclusion are lazy: they reach the editor host seam, and an eager import from
// a file base-kit composes closes an import cycle. Without the `]]` input rule a typed `[[Note]]`
// stays text and the serializer escapes it to `\[\[Note]]` on save.

import { Suspense, lazy } from "react";
import { KEYS, NodeApi, TextApi, createSlatePlugin, type SlateEditor } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { stringProp } from "@repo/editor/node-props";
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

// mirrors the remark-wiki-link grammar so the chip and the bytes agree.
const WIKI_COMPLETION_RE = /(!?)\[\[([^[\]\n]+)\]$/;

function chipLabel(body: string): string {
  const parsed = parseWikiBody(body);
  if (parsed.alias) return parsed.alias;
  return parsed.anchor ? `${parsed.target}#${parsed.anchor}` : parsed.target;
}

function FallbackChip({ body, embed }: { body: string; embed?: boolean }) {
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

function WikiLinkElement(props: PlateElementProps) {
  const body = stringProp(props.element, "body") ?? "";
  return (
    <PlateElement {...props} as="span" className="inline-block">
      <span contentEditable={false}>
        <Suspense fallback={<FallbackChip body={body} />}>
          <WikiChip body={body} />
        </Suspense>
      </span>
      {props.children}
    </PlateElement>
  );
}

function WikiEmbedElement(props: PlateElementProps) {
  const body = stringProp(props.element, "body") ?? "";
  return (
    <PlateElement {...props} as="span" className="inline-block w-full">
      <span contentEditable={false} className="block w-full">
        <Suspense fallback={<FallbackChip body={body} embed />}>
          <Transclusion body={body} />
        </Suspense>
      </span>
      {props.children}
    </PlateElement>
  );
}

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
  // Slate would otherwise park the caret inside the void's empty text and swallow keystrokes.
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
        insertText(text, options) {
          if (text === "]" && completeWikiChip(editor)) return;
          insertText(text, options);
        },
      },
    })),
  wikiEmbedBasePlugin.withComponent(WikiEmbedElement),
];
