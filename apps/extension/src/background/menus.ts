// the right-click Save: one item per thing a person can point at, and what a click on each asks
// the Mac to keep. A page or a selection is captured from the tab; a link or an image is saved by
// what the click names, so no page needs scripting for them.

import type { BrowserSave } from "@repo/contract/browser/browser-wire";

export type MenuContext = "page" | "link" | "image" | "selection";

export const MENU_ITEMS = [
  { context: "page", id: "save-page", title: "Save page" },
  { context: "link", id: "save-link", title: "Save link" },
  { context: "image", id: "save-image", title: "Save image" },
  { context: "selection", id: "save-selection", title: "Save as a highlight" },
] as const satisfies readonly { context: MenuContext; id: string; title: string }[];

// the fields of a click this reads, as Chrome's OnClickData names them
export interface MenuClick {
  menuItemId: string | number;
  linkUrl?: string | undefined;
  srcUrl?: string | undefined;
  selectionText?: string | undefined;
}

export type MenuAction =
  // capture the tab, its selection included
  | { kind: "page" }
  // capture the tab for its selection; `text` is Chrome's own reading of it, for a page that
  // cannot be scripted
  | { kind: "selection"; text: string }
  | { kind: "save"; save: BrowserSave }
  | { kind: "unsupported" };

const WEB_PROTOCOLS = new Set(["http:", "https:"]);

export const isWebUrl = (value: string | undefined): value is string => {
  if (value === undefined) {
    return false;
  }
  try {
    return WEB_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
};

const DATA_URL = /^data:(?<mime>[^;,]*)(?<params>(?:;[^;,]*)*),(?<data>.*)$/su;

const base64OfBytes = (bytes: Uint8Array): string => {
  const chunk = 0x80_00;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCodePoint(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

// an image the page drew from a data: url has no address to save, so its bytes go instead, under
// the media type it names; the Mac keeps them only if that is a picture's
export const imageBytesOfDataUrl = (
  url: string,
): { base64: string; kind: "bytes"; mime: string } | null => {
  const match = DATA_URL.exec(url);
  if (match?.groups === undefined) {
    return null;
  }
  const { data = "", mime = "", params = "" } = match.groups;
  if (mime === "") {
    return null;
  }
  const isBase64 = params.split(";").some((param) => param.trim().toLowerCase() === "base64");
  try {
    const base64 = isBase64
      ? data
      : base64OfBytes(new TextEncoder().encode(decodeURIComponent(data)));
    return { base64, kind: "bytes", mime };
  } catch {
    return null;
  }
};

export const menuAction = (click: MenuClick): MenuAction => {
  switch (click.menuItemId) {
    case "save-page": {
      return { kind: "page" };
    }
    case "save-selection": {
      return { kind: "selection", text: click.selectionText ?? "" };
    }
    case "save-link": {
      return isWebUrl(click.linkUrl)
        ? { kind: "save", save: { target: "link", title: null, url: click.linkUrl } }
        : { kind: "unsupported" };
    }
    case "save-image": {
      if (isWebUrl(click.srcUrl)) {
        return { kind: "save", save: { src: { kind: "url", url: click.srcUrl }, target: "image" } };
      }
      const bytes = click.srcUrl === undefined ? null : imageBytesOfDataUrl(click.srcUrl);
      return bytes === null
        ? { kind: "unsupported" }
        : { kind: "save", save: { src: bytes, target: "image" } };
    }
    default: {
      return { kind: "unsupported" };
    }
  }
};
