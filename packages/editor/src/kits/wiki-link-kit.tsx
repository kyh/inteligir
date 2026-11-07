// WikiChip and Transclusion are lazy: they reach the editor host seam, and an eager import from
// a file base-kit composes closes an import cycle. Without the `]]` input rule a typed `[[Note]]`
// stays text and the serializer escapes it to `\[\[Note]]` on save.

import { Suspense, lazy } from "react";
import { KEYS, NodeApi, TextApi } from "platejs";
import type { SlateEditor } from "platejs";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { WIKI_EMBED_KEY, WIKI_LINK_KEY } from "@repo/editor/dialect-node-keys";
import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { wikiFieldsOf, wikiLabelOf, wikiNodeOfBody } from "@repo/editor/wiki/wiki-node";
import type { WikiNodeFields } from "@repo/editor/wiki/wiki-node";

import { wikiEmbedBasePlugin, wikiLinkBasePlugin } from "./headless/wiki-link-base";

const WikiChip = lazy(async () => await import("@repo/editor/wiki/wiki-chip"));
const Transclusion = lazy(async () => await import("@repo/editor/transclusion"));

// mirrors the remark-wiki-link grammar so the chip and the bytes agree.
const WIKI_COMPLETION_RE = /(?<bang>!?)\[\[(?<body>[^[\]\n]+)\]$/u;

const FallbackChip = ({ link, embed }: { link: WikiNodeFields; embed?: boolean }) => (
  <span
    contentEditable={false}
    className="cursor-default rounded-sm bg-primary/10 px-1 text-primary/80"
  >
    {embed === true && <span className="mr-0.5 font-semibold text-primary/50 select-none">!</span>}
    {wikiLabelOf(link)}
  </span>
);

const WikiLinkElement = (props: PlateElementProps) => {
  const link = wikiFieldsOf(props.element);
  return (
    <PlateElement {...props} as="span" className="inline-block">
      <span contentEditable={false}>
        <Suspense fallback={<FallbackChip link={link} />}>
          <WikiChip link={link} />
        </Suspense>
      </span>
      {props.children}
    </PlateElement>
  );
};

const WikiEmbedElement = (props: PlateElementProps) => {
  const link = wikiFieldsOf(props.element);
  return (
    <PlateElement {...props} as="span" className="inline-block w-full">
      <span contentEditable={false} className="block w-full">
        <Suspense fallback={<FallbackChip link={link} embed />}>
          <Transclusion link={link} />
        </Suspense>
      </span>
      {props.children}
    </PlateElement>
  );
};

const completeWikiChip = (editor: SlateEditor): boolean => {
  if (!editor.selection || !editor.api.isCollapsed()) {
    return false;
  }
  if (editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } })) {
    return false;
  }
  const { anchor } = editor.selection;
  const leaf = NodeApi.get(editor, anchor.path);
  if (!leaf || !TextApi.isText(leaf)) {
    return false;
  }
  const match = WIKI_COMPLETION_RE.exec(leaf.text.slice(0, anchor.offset));
  if (!match) {
    return false;
  }
  const [full] = match;
  const bang = match.groups?.bang ?? "";
  const body = match.groups?.body ?? "";
  if (body === "") {
    return false;
  }
  editor.tf.withoutNormalizing(() => {
    editor.tf.delete({
      at: {
        anchor: { offset: anchor.offset - full.length, path: anchor.path },
        focus: anchor,
      },
    });
  });
  // Slate would otherwise park the caret inside the void's empty text and swallow keystrokes.
  insertVoidAndEscape(editor, wikiNodeOfBody(bang ? WIKI_EMBED_KEY : WIKI_LINK_KEY, body));
  return true;
};

export const WikiLinkKit = [
  wikiLinkBasePlugin
    .withComponent(WikiLinkElement)
    .overrideEditor(({ editor, tf: { insertText } }) => ({
      transforms: {
        insertText(text, options) {
          if (text === "]" && completeWikiChip(editor)) {
            return;
          }
          insertText(text, options);
        },
      },
    })),
  wikiEmbedBasePlugin.withComponent(WikiEmbedElement),
];
