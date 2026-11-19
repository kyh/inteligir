import { safeDecode } from "@repo/contract/text/safe-decode";

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

export const mdLinkTarget = (url: string) => {
  if (url === "" || url.startsWith("#") || url.startsWith("//") || SCHEME.test(url)) {
    return null;
  }

  const hash = url.indexOf("#");

  return safeDecode(hash === -1 ? url : url.slice(0, hash));
};

export const mdLinkUrl = (path: string) => path.replaceAll("%", "%25").replaceAll("#", "%23");
