// A url item before its page is read: what the Mac's save and the phone's share write.

import { composeLinkBody } from "./item-body";
import { composeItemFile } from "./item-frontmatter";
import type { ItemFileFields } from "./item-frontmatter";
import { formatItemTime } from "./item-time";
import { cleanUrl, kindForUrl } from "./item-url";

// `note`, trimmed, becomes the body ("" for none); `saved` is epoch ms
export const linkStubText = (s: {
  id: string;
  url: string;
  saved: number;
  note: string;
  tags?: readonly string[];
}): string => {
  const fields: ItemFileFields = {
    id: s.id,
    kind: kindForUrl(s.url),
    saved: formatItemTime(s.saved),
    url: cleanUrl(s.url),
  };
  if (s.tags !== undefined) {
    fields.tags = s.tags;
  }
  return composeItemFile(
    fields,
    // trimmed whole, so a share's indented or padded note lands as the editor would write it
    composeLinkBody({ article: "", copy: null, cover: null, note: s.note.trim() }),
  );
};
