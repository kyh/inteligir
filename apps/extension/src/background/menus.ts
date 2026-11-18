import { isWebUrl } from "@repo/contract/items/item-url";

export type MenuContext = "page" | "link" | "image";

export const MENU_ITEMS = [
  { context: "page", id: "save-page", title: "Save page" },
  { context: "link", id: "save-link", title: "Save link" },
  { context: "image", id: "save-image", title: "Save image" },
] as const satisfies readonly { context: MenuContext; id: string; title: string }[];

export interface MenuClick {
  menuItemId: string | number;
  linkUrl?: string | undefined;
  srcUrl?: string | undefined;
}

type MenuAction =
  | { kind: "page" }
  | { kind: "address"; url: string }
  | { kind: "picture"; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "unsupported" };

export const bytesOfDataUrl = async (url: string) => {
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

export const menuAction = async (click: MenuClick) => {
  switch (click.menuItemId) {
    case "save-page": {
      return { kind: "page" } satisfies MenuAction;
    }

    case "save-link": {
      return (
        click.linkUrl !== undefined && isWebUrl(click.linkUrl)
          ? { kind: "address", url: click.linkUrl }
          : { kind: "unsupported" }
      ) satisfies MenuAction;
    }

    case "save-image": {
      if (click.srcUrl !== undefined && isWebUrl(click.srcUrl)) {
        return { kind: "address", url: click.srcUrl } satisfies MenuAction;
      }

      const bytes = click.srcUrl === undefined ? null : await bytesOfDataUrl(click.srcUrl);

      return (
        bytes === null ? { kind: "unsupported" } : { kind: "picture", bytes }
      ) satisfies MenuAction;
    }

    default: {
      return { kind: "unsupported" } satisfies MenuAction;
    }
  }
};
