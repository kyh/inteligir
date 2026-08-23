// Embed kit: url-only media (youtube + video providers via `video`, tweet +
// generic iframe via `media_embed`, pdf via `file`). Uploads, images, audio,
// placeholders and captions are all out of scope — inserts must never write
// `align`/`width`/`isUpload` (bare `src`-only forms are the canonical bytes).

import { ElementApi, KEYS, NodeApi, PathApi, type TElement } from "platejs";
import { createPlatePlugin, type PlateEditor } from "platejs/react";
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

const PDF_RE = /\.pdf(?:[?#]|$)/i;

/** The `{ type, url }` node an embed insert produces, routed by URL shape. */
function embedNodeForUrl(url: string): TElement {
  const type = parseVideoUrl(url)
    ? KEYS.video
    : parseTwitterUrl(url)
      ? KEYS.mediaEmbed
      : PDF_RE.test(url)
        ? KEYS.file
        : KEYS.mediaEmbed;
  return { children: [{ text: "" }], type, url };
}

/**
 * Insert an embed for `url`, routed by shape: video-provider URLs (youtube/
 * vimeo/…) → `video`; tweet status URLs → `media_embed` (tweet card); `.pdf`
 * → `file` (viewer); anything else → `media_embed` (generic iframe). The node
 * carries ONLY `{ type, url }`. The slash menu's Embed item collects the URL
 * via embed-url-dialog.tsx and routes here.
 */
export function insertEmbedFromUrl(editor: PlateEditor, url: string): void {
  const trimmed = url.trim();
  if (trimmed === "") return;
  insertVoidAndEscape(editor, embedNodeForUrl(trimmed));
}

// ---- Bare-URL auto-embed ----------------------------------------------------
// A bare YouTube/tweet URL landing alone on an empty paragraph becomes the
// embed the dialog would have made — same node, same bytes. ONLY those two:
// pdf/iframe stay text (later an autolink), because a generic URL turning
// into an iframe on paste is a surprise, while a video/tweet pill is the
// expectation a modern editor sets.

const BARE_URL_RE = /^https?:\/\/\S+$/i;

function isAutoEmbedUrl(text: string): boolean {
  return (
    BARE_URL_RE.test(text) &&
    (parseVideoUrl(text) !== undefined || parseTwitterUrl(text) !== undefined)
  );
}

/** The selection's block, when it is an EMPTY plain paragraph. */
function emptyParagraphEntry(editor: PlateEditor): [TElement, number[]] | null {
  if (editor.selection === null || !editor.api.isCollapsed()) return null;
  const entry = editor.api.block();
  if (!entry || !ElementApi.isElement(entry[0])) return null;
  const [node, path] = entry;
  if (node.type !== editor.getType(KEYS.p)) return null;
  if (node.listStyleType !== undefined) return null;
  if (NodeApi.string(node) !== "") return null;
  return [node, path];
}

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
      // The typed path: Enter after a paragraph that IS a bare embed URL
      // converts the paragraph in place (the Enter is spent on the convert;
      // insertVoidAndEscape-style escape puts the caret on a fresh line).
      onKeyDown: ({ editor, event }) => {
        if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return;
        if (editor.selection === null || !editor.api.isCollapsed()) return;
        const entry = editor.api.block();
        if (!entry || !ElementApi.isElement(entry[0])) return;
        const [node, path] = entry;
        if (node.type !== editor.getType(KEYS.p) || node.listStyleType !== undefined) return;
        const text = NodeApi.string(node).trim();
        if (!isAutoEmbedUrl(text)) return;
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
