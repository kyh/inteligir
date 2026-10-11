// what a url embeds as, spelled once for the insert that makes an embed and the parse that reads
// `![](url)` back as one: a url naming no video, tweet or pdf is a page.

import { KEYS } from "platejs";
import { parseTwitterUrl, parseVideoUrl } from "@platejs/media";

import { isPdfUrl } from "@repo/editor/lib/wire";

type EmbedType = typeof KEYS.file | typeof KEYS.mediaEmbed | typeof KEYS.video;

export const embedTypeForUrl = (url: string): EmbedType => {
  if (parseVideoUrl(url) !== undefined) {
    return KEYS.video;
  }
  if (parseTwitterUrl(url) !== undefined) {
    return KEYS.mediaEmbed;
  }
  return isPdfUrl(url) ? KEYS.file : KEYS.mediaEmbed;
};
