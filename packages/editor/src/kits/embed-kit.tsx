// An embed saves as `![](url)`, so its url is all of it that reaches the file.

import { ElementApi, KEYS, NodeApi, PathApi } from "platejs";
import type { TElement } from "platejs";
import { createPlatePlugin } from "platejs/react";
import type { PlateEditor } from "platejs/react";
import { parseTwitterUrl, parseVideoUrl } from "@platejs/media";
import { FilePlugin, MediaEmbedPlugin, VideoPlugin } from "@platejs/media/react";
import { isImeComposing } from "@repo/ui/lib/ime";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { embedTypeForUrl } from "@repo/editor/lib/embed-url";

import { FileElement } from "@repo/editor/nodes/pdf-node";
import { remoteMediaElement } from "@repo/editor/nodes/remote-media-node";

// null for a url off the web, which would read back as an image
const embedNodeForUrl = (url: string): TElement | null => {
  const type = embedTypeForUrl(url);
  return type === null ? null : { children: [{ text: "" }], type, url };
};

export const insertEmbedFromUrl = (editor: PlateEditor, url: string): boolean => {
  const embed = embedNodeForUrl(url.trim());
  if (embed === null) {
    return false;
  }
  insertVoidAndEscape(editor, embed);
  return true;
};

// Only video/tweet URLs auto-embed: a generic URL pasted as a link must stay a link.
const BARE_URL_RE = /^https?:\/\/\S+$/iu;

const isAutoEmbedUrl = (text: string): boolean =>
  BARE_URL_RE.test(text) &&
  (parseVideoUrl(text) !== undefined || parseTwitterUrl(text) !== undefined);

const emptyParagraphEntry = (editor: PlateEditor): [TElement, number[]] | null => {
  if (editor.selection === null || !editor.api.isCollapsed()) {
    return null;
  }
  const entry = editor.api.block();
  if (!entry || !ElementApi.isElement(entry[0])) {
    return null;
  }
  const [node, path] = entry;
  if (node.type !== editor.getType(KEYS.p)) {
    return null;
  }
  if (node.listStyleType !== undefined) {
    return null;
  }
  if (NodeApi.string(node) !== "") {
    return null;
  }
  return [node, path];
};

const AutoEmbedPlugin = createPlatePlugin({ key: "embedAutoPill" })
  .overrideEditor(({ editor, tf: { insertData } }) => ({
    transforms: {
      insertData(data) {
        const text = data.getData("text/plain").trim();
        if (text !== "" && isAutoEmbedUrl(text) && emptyParagraphEntry(editor) !== null) {
          insertEmbedFromUrl(editor, text);
          return;
        }
        insertData(data);
      },
    },
  }))
  .extend(() => ({
    handlers: {
      // Plate runs a plugin's keydown ahead of Slate's own composition check
      onKeyDown: ({ editor, event }) => {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey ||
          isImeComposing(event)
        ) {
          return;
        }
        if (editor.selection === null || !editor.api.isCollapsed()) {
          return;
        }
        const entry = editor.api.block();
        if (!entry || !ElementApi.isElement(entry[0])) {
          return;
        }
        const [node, path] = entry;
        if (node.type !== editor.getType(KEYS.p) || node.listStyleType !== undefined) {
          return;
        }
        const text = NodeApi.string(node).trim();
        const embed = isAutoEmbedUrl(text) ? embedNodeForUrl(text) : null;
        if (embed === null) {
          return;
        }
        event.preventDefault();
        editor.tf.withoutNormalizing(() => {
          editor.tf.removeNodes({ at: path });
          editor.tf.insertNodes(embed, { at: path });
          editor.tf.insertNodes(
            { children: [{ text: "" }], type: editor.getType(KEYS.p) },
            { at: PathApi.next(path), select: true },
          );
        });
      },
    },
  }));

export const EmbedKit = [
  VideoPlugin.withComponent(remoteMediaElement("video")),
  MediaEmbedPlugin.withComponent(remoteMediaElement("page")),
  FilePlugin.withComponent(FileElement),
  AutoEmbedPlugin,
];
