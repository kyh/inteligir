// Embed kit: url-only media (youtube + video providers via `video`, tweet +
// generic iframe via `media_embed`, pdf via `file`). Uploads, images, audio,
// placeholders and captions are all out of scope — inserts must never write
// `align`/`width`/`isUpload` (bare `src`-only forms are the canonical bytes).

import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";
import {
  BaseFilePlugin,
  BaseMediaEmbedPlugin,
  BaseVideoPlugin,
  parseTwitterUrl,
  parseVideoUrl,
} from "@platejs/media";
import { FilePlugin, MediaEmbedPlugin, VideoPlugin } from "@platejs/media/react";

import { MediaEmbedElement } from "@repo/app/editor/nodes/embed-node";
import { FileElement } from "@repo/app/editor/nodes/pdf-node";
import { VideoElement } from "@repo/app/editor/nodes/youtube-node";

export const EmbedBaseKit = [BaseVideoPlugin, BaseMediaEmbedPlugin, BaseFilePlugin];

const PDF_RE = /\.pdf(?:[?#]|$)/i;

/**
 * Insert an embed for `url`, routed by shape: video-provider URLs (youtube/
 * vimeo/…) → `video`; tweet status URLs → `media_embed` (tweet card); `.pdf`
 * → `file` (viewer); anything else → `media_embed` (generic iframe). The node
 * carries ONLY `{ type, url }`. Slash-menu URL prompt lands in WP3.
 */
export function insertEmbedFromUrl(editor: PlateEditor, url: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  const type = parseVideoUrl(trimmed)
    ? KEYS.video
    : parseTwitterUrl(trimmed)
      ? KEYS.mediaEmbed
      : PDF_RE.test(trimmed)
        ? KEYS.file
        : KEYS.mediaEmbed;
  editor.tf.insertNodes({ children: [{ text: "" }], type, url: trimmed }, { select: true });
}

export const EmbedKit = [
  VideoPlugin.withComponent(VideoElement),
  MediaEmbedPlugin.withComponent(MediaEmbedElement),
  FilePlugin.withComponent(FileElement),
];
