// What text written into the library from outside the editor names in it, for the agent and a
// save's note: `[[Title]]` the one live item filed under that title, `![[path]]` a file the view
// wrote under that path, and a page link's id an item the library holds. Anything else names
// nothing, so it stays the text it was.

import type { FileKind } from "@repo/contract/items/item-kind";
import type { WikiResolve } from "@repo/editor/markdown/remark-wiki-import";

import { viewFileAt } from "./item-view";
import type { LinkedItem } from "./read-blocks";

export interface LibraryLookup {
  // the item a title names when exactly one does
  readonly itemByTitle: (title: string) => string | null;
  // an item's live title; null for an id no live item holds
  readonly title: (itemId: string) => string | null;
  // what kind of file the library holds under a sha; null for bytes it does not hold
  readonly fileKind: (sha: string) => FileKind | null;
}

export interface LibraryLinks {
  readonly wiki: WikiResolve;
  readonly item: (key: string) => LinkedItem | null;
}

export const libraryLinks = (lookup: LibraryLookup): LibraryLinks => ({
  item: (key) => {
    const title = lookup.title(key);
    return title === null ? null : { itemId: key, title };
  },
  wiki: (link, embed) => {
    const file = embed ? viewFileAt(link.target) : null;
    if (file !== null && lookup.fileKind(file.sha) !== null) {
      return { kind: "file", url: link.target };
    }
    const itemId = link.target === "" ? null : lookup.itemByTitle(link.target);
    return itemId === null
      ? null
      : { itemId, kind: "item", title: lookup.title(itemId) ?? link.target };
  },
});
