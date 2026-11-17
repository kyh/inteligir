// The path an md url names and the url a path is written as, which an import resolves a link and
// files an embed by.

import { safeDecode } from "@repo/contract/text/safe-decode";

// anything with a scheme (`https:`, `mailto:`, `C:\…` alike) or protocol-relative `//` is external
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

// the path an md url names, percent-decoded and its anchor left off; null for an external or
// same-note url
export const mdLinkTarget = (url: string): string | null => {
  if (url === "" || url.startsWith("#") || url.startsWith("//") || SCHEME.test(url)) {
    return null;
  }
  const hash = url.indexOf("#");
  return safeDecode(hash === -1 ? url : url.slice(0, hash));
};

// a path as an md url `mdLinkTarget` reads back as that path
export const mdLinkUrl = (path: string): string =>
  path.replaceAll("%", "%25").replaceAll("#", "%23");
