// the items service's one refusal class: a closed code union, each code's sentence spelled here
// once, and the router maps every code to its wire class through a total table
// (items-router.ts). a service throws only this, a vault refusal, or nothing.

import { fileTooLargeMessage } from "@repo/notes/items/item-kind";

type ItemsRefusal =
  // the file is over ITEM_FILE_MAX_BYTES
  | [code: "too-large", subject: { name: string; bytes: number }]
  // the name a file would be saved under is a doc's or the app's own
  | [code: "not-a-file-name"]
  | [code: "folder-is-file", subject: { folder: string }]
  // every free name the create tried was taken under it
  | [code: "names-exhausted"]
  | [code: "not-found", subject: { path: string }]
  // a refresh of an item that has no page to read
  | [code: "not-url-item"]
  // a refresh that would replace a body whose highlights would then point nowhere
  | [code: "has-highlights"];

export type ItemsErrorCode = ItemsRefusal[0];

const sentenceOf = (refusal: ItemsRefusal): string => {
  switch (refusal[0]) {
    case "too-large": {
      return fileTooLargeMessage(refusal[1].name, refusal[1].bytes);
    }
    case "not-a-file-name": {
      return "a note is saved as text, not as a file";
    }
    case "folder-is-file": {
      return `${refusal[1].folder} is a file, so nothing can be saved into it`;
    }
    case "names-exhausted": {
      return "That name kept being taken. Try again.";
    }
    case "not-found": {
      return `${refusal[1].path} is not an item`;
    }
    case "not-url-item": {
      return "Only a saved link can be refreshed.";
    }
    case "has-highlights": {
      return "Its highlights would be lost; remove them first.";
    }
    default: {
      const exhaustive: never = refusal;
      return exhaustive;
    }
  }
};

export class ItemsError extends Error {
  readonly code: ItemsErrorCode;

  constructor(...refusal: ItemsRefusal) {
    super(sentenceOf(refusal));
    const [code] = refusal;
    this.name = "ItemsError";
    this.code = code;
  }
}
