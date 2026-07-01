// Embed kit — Base half (WP1): url-only media (youtube via video, tweet +
// generic iframe via media_embed, pdf via file). Uploads, images, audio,
// placeholders and captions are all out of scope — inserts must never write
// `align`/`width`/`isUpload` (bare `src`-only forms are the canonical bytes).
// WP2 appends EmbedKit (react nodes) and insertEmbedFromUrl.

import { BaseFilePlugin, BaseMediaEmbedPlugin, BaseVideoPlugin } from "@platejs/media";

export const EmbedBaseKit = [BaseVideoPlugin, BaseMediaEmbedPlugin, BaseFilePlugin];
