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

import { insertVoidAndEscape } from "@repo/editor/insert-void";

import { MediaEmbedElement } from "@repo/editor/nodes/embed-node";
import { FileElement } from "@repo/editor/nodes/pdf-node";
import { VideoElement } from "@repo/editor/nodes/youtube-node";

export const EmbedBaseKit = [BaseVideoPlugin, BaseMediaEmbedPlugin, BaseFilePlugin];

const PDF_RE = /\.pdf(?:[?#]|$)/i;

/**
 * Insert an embed for `url`, routed by shape: video-provider URLs (youtube/
 * vimeo/…) → `video`; tweet status URLs → `media_embed` (tweet card); `.pdf`
 * → `file` (viewer); anything else → `media_embed` (generic iframe). The node
 * carries ONLY `{ type, url }`. The slash menu's Embed item collects the URL
 * via embed-url-dialog.tsx and routes here.
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
  insertVoidAndEscape(editor, { children: [{ text: "" }], type, url: trimmed });
}

export const EmbedKit = [
  VideoPlugin.withComponent(VideoElement),
  MediaEmbedPlugin.withComponent(MediaEmbedElement),
  FilePlugin.withComponent(FileElement),
];
