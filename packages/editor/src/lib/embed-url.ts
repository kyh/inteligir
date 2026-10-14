// what a url embeds as, spelled once for the insert that makes an embed and the parse that reads
// `![](url)` back as one: only a url on the web embeds, since `![](path)` is a vault image, and a
// url naming no video, tweet or pdf is a page.

import { KEYS } from "platejs";
import { parseTwitterUrl, parseVideoUrl } from "@platejs/media";

import { isHttpUrl, isPdfUrl } from "@repo/editor/lib/url";

type EmbedType = typeof KEYS.file | typeof KEYS.mediaEmbed | typeof KEYS.video;

export const embedTypeForUrl = (url: string): EmbedType | null => {
  if (!isHttpUrl(url)) {
    return null;
  }
  if (parseVideoUrl(url) !== undefined) {
    return KEYS.video;
  }
  if (parseTwitterUrl(url) !== undefined) {
    return KEYS.mediaEmbed;
  }
  return isPdfUrl(url) ? KEYS.file : KEYS.mediaEmbed;
};
