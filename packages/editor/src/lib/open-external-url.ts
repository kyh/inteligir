import { isWebUrl } from "@repo/contract/items/item-url";

export const openExternalUrl = (url: string) => {
  if (isWebUrl(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};
