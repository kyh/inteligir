import { KEYS } from "platejs";
import { parseTwitterUrl, parseVideoUrl } from "@platejs/media";

import { isWebUrl } from "@repo/contract/items/item-url";

import { isPdfUrl } from "@repo/editor/headless/lib/url";

export const embedTypeForUrl = (url: string) => {
  if (!isWebUrl(url)) {
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
