// the right-click Save: one item per thing a person can point at, and what a click on each saves.
// A page is read from the tab; a link or a web picture is saved by the address the click names, which the cloud reads, and a picture a page drew from its own bytes by those bytes.

import { isWebUrl } from "@repo/contract/items/item-url";

export type MenuContext = "page" | "link" | "image";

export const MENU_ITEMS = [
  { context: "page", id: "save-page", title: "Save page" },
  { context: "link", id: "save-link", title: "Save link" },
  { context: "image", id: "save-image", title: "Save image" },
] as const satisfies readonly { context: MenuContext; id: string; title: string }[];

// the fields of a click this reads, as the browser's OnClickData names them
export interface MenuClick {
  menuItemId: string | number;
  linkUrl?: string | undefined;
  srcUrl?: string | undefined;
}

export type MenuAction =
  // read the tab
  | { kind: "page" }
  | { kind: "address"; url: string }
  | { kind: "picture"; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "unsupported" };

// the bytes a data: url holds, read by the browser's own fetch as it reads the picture; what they
// are is for the save to sniff
export const bytesOfDataUrl = async (url: string): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (URL.parse(url)?.protocol !== "data:") {
    return null;
  }
  try {
    const response = await fetch(url);
    return await response.bytes();
  } catch {
    return null;
  }
};

export const menuAction = async (click: MenuClick): Promise<MenuAction> => {
  switch (click.menuItemId) {
    case "save-page": {
      return { kind: "page" };
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
      const bytes = click.srcUrl === undefined ? null : await bytesOfDataUrl(click.srcUrl);
      return bytes === null ? { kind: "unsupported" } : { kind: "picture", bytes };
    }
    default: {
      return { kind: "unsupported" };
    }
  }
};
