// the right-click Save: one item per thing a person can point at, and what a click on each saves.
// A page or a selection is read from the tab; a link or a web picture is saved by the address the
// click names, which the cloud reads, and a picture a page drew from its own bytes by those bytes.

import { isWebUrl } from "@repo/notes/items/item-url";

export type MenuContext = "page" | "link" | "image" | "selection";

export const MENU_ITEMS = [
  { context: "page", id: "save-page", title: "Save page" },
  { context: "link", id: "save-link", title: "Save link" },
  { context: "image", id: "save-image", title: "Save image" },
  { context: "selection", id: "save-selection", title: "Save as a highlight" },
] as const satisfies readonly { context: MenuContext; id: string; title: string }[];

// the fields of a click this reads, as the browser's OnClickData names them
export interface MenuClick {
  menuItemId: string | number;
  linkUrl?: string | undefined;
  srcUrl?: string | undefined;
  selectionText?: string | undefined;
}

export type MenuAction =
  // read the tab, its selection included
  | { kind: "page" }
  // read the tab for its selection; `text` is the browser's own reading of it, for a page that
  // cannot be scripted
  | { kind: "selection"; text: string }
  | { kind: "address"; url: string }
  | { kind: "picture"; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "unsupported" };

const DATA_URL = /^data:(?<params>[^,]*),(?<data>.*)$/su;
const ESCAPE_OR_TEXT = /%(?<hex>[0-9a-f]{2})|(?<text>[^%]+)|%/giu;

const bytesOfBase64 = (base64: string): Uint8Array<ArrayBuffer> | null => {
  try {
    return Uint8Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);
  } catch {
    return null;
  }
};

// a data: url's percent-encoded body as the bytes it names: an escape is one byte whatever it
// spells (a PNG's %89 included), the rest its UTF-8; a stray % is no such body
const bytesOfPercentEncoded = (data: string): Uint8Array<ArrayBuffer> | null => {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (const match of data.matchAll(ESCAPE_OR_TEXT)) {
    const { hex, text } = match.groups ?? {};
    if (hex !== undefined) {
      bytes.push(Number.parseInt(hex, 16));
    } else if (text === undefined) {
      return null;
    } else {
      bytes.push(...encoder.encode(text));
    }
  }
  return Uint8Array.from(bytes);
};

// the bytes a data: url holds; what they are is for the save to sniff
export const bytesOfDataUrl = (url: string): Uint8Array<ArrayBuffer> | null => {
  const match = DATA_URL.exec(url);
  if (match?.groups === undefined) {
    return null;
  }
  const { data = "", params = "" } = match.groups;
  const isBase64 = params.split(";").some((param) => param.trim().toLowerCase() === "base64");
  return isBase64 ? bytesOfBase64(data) : bytesOfPercentEncoded(data);
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
      return click.linkUrl !== undefined && isWebUrl(click.linkUrl)
        ? { kind: "address", url: click.linkUrl }
        : { kind: "unsupported" };
    }
    case "save-image": {
      if (click.srcUrl !== undefined && isWebUrl(click.srcUrl)) {
        return { kind: "address", url: click.srcUrl };
      }
      const bytes = click.srcUrl === undefined ? null : bytesOfDataUrl(click.srcUrl);
      return bytes === null ? { kind: "unsupported" } : { kind: "picture", bytes };
    }
    default: {
      return { kind: "unsupported" };
    }
  }
};
