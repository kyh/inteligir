// Inserts never write align/width/isUpload: the bare src-only form is the canonical bytes.

import { ElementApi, KEYS, NodeApi, PathApi } from "platejs";
import type { TElement } from "platejs";
import { createPlatePlugin } from "platejs/react";
import type { PlateEditor } from "platejs/react";
import {
  BaseFilePlugin,
  BaseMediaEmbedPlugin,
  BaseVideoPlugin,
  parseTwitterUrl,
  parseVideoUrl,
} from "@platejs/media";
import { FilePlugin, MediaEmbedPlugin, VideoPlugin } from "@platejs/media/react";

import { insertVoidAndEscape } from "@repo/editor/insert-void";

import { MediaEmbedElement } from "@repo/editor/nodes/embed-node";
import { FileElement } from "@repo/editor/nodes/pdf-node";
import { VideoElement } from "@repo/editor/nodes/youtube-node";

export const EmbedBaseKit = [BaseVideoPlugin, BaseMediaEmbedPlugin, BaseFilePlugin];

const PDF_RE = /\.pdf(?:[?#]|$)/iu;

const embedTypeForUrl = (url: string): string => {
  if (parseVideoUrl(url) !== undefined) {
    return KEYS.video;
  }
  if (parseTwitterUrl(url) !== undefined) {
    return KEYS.mediaEmbed;
  }
  if (PDF_RE.test(url)) {
    return KEYS.file;
  }
  return KEYS.mediaEmbed;
};

const embedNodeForUrl = (url: string): TElement => ({
  children: [{ text: "" }],
  type: embedTypeForUrl(url),
  url,
});

export const insertEmbedFromUrl = (editor: PlateEditor, url: string): void => {
  const trimmed = url.trim();
  if (trimmed === "") {
    return;
  }
  insertVoidAndEscape(editor, embedNodeForUrl(trimmed));
};

// Only video/tweet URLs auto-embed: a generic URL becoming an iframe on paste is a surprise.
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
      onKeyDown: ({ editor, event }) => {
        if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) {
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
        if (!isAutoEmbedUrl(text)) {
          return;
        }
        event.preventDefault();
        editor.tf.withoutNormalizing(() => {
          editor.tf.removeNodes({ at: path });
          editor.tf.insertNodes(embedNodeForUrl(text), { at: path });
          editor.tf.insertNodes(
            { children: [{ text: "" }], type: editor.getType(KEYS.p) },
            { at: PathApi.next(path), select: true },
          );
        });
      },
    },
  }));

export const EmbedKit = [
  VideoPlugin.withComponent(VideoElement),
  MediaEmbedPlugin.withComponent(MediaEmbedElement),
  FilePlugin.withComponent(FileElement),
  AutoEmbedPlugin,
];
