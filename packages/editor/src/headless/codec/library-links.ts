import type { FileKind } from "@repo/contract/items/item-kind";
import type { WikiResolve } from "@repo/editor/headless/markdown/remark-wiki-import";

import { viewFileAt } from "./item-view";
import type { LibraryFile, LinkedItem } from "./read-blocks";

export interface LibraryLookup {
  readonly itemByTitle: (title: string) => string | null;
  readonly title: (itemId: string) => string | null;
  readonly fileKind: (sha: string) => FileKind | null;
}

export interface LibraryLinks {
  readonly wiki: WikiResolve;
  readonly item: (key: string) => LinkedItem | null;
  readonly image: (url: string) => LibraryFile | null;
}

export const libraryLinks = (lookup: LibraryLookup) =>
  ({
    image: (url) => {
      const file = viewFileAt(url);
      const kind = file === null ? null : lookup.fileKind(file.sha);

      return file === null || kind === null
        ? null
        : { kind, name: file.name ?? file.sha, path: url, sha: file.sha };
    },
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
  }) satisfies LibraryLinks;
