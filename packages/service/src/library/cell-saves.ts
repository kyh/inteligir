// Saving a web address: one url, one item. A save of an address a live item holds answers that
// item as it stands and writes nothing, unless it is a page a device read itself (the extension)
// and the item has no article yet, its reading still waiting or failed: then the read lands on it
// as a reading does. Only an address no live item holds makes an item. A page a device read lands
// read; one saved to read later lands at once as an unread stub, `pending`, which the cloud reads
// afterwards. The words saved with it go in the new item's note. An item whose note writes its
// body takes a page's article there (`./article-landing`), so the write lands only the fields.

import type { FolderTarget } from "@repo/contract/library/cell-rules";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { pageFields, stubFields } from "@repo/contract/library/item-makes";
import { readingOf, withReading } from "@repo/contract/library/item-reading";
import { readLiveItem } from "./library-queries";
import type { LiveStoredItem } from "./library-queries";
import { itemNameFromUrl } from "@repo/contract/items/item-name";
import { urlKey } from "@repo/contract/items/item-url";

import { withArticle } from "../note/article-body";
import { bodyWriter, readSeedBlocks } from "./cell-body";
import type { CellCodec } from "./cell-codec";
import { folderOfTarget } from "./cell-folders";
import type { CellIds } from "./cell-ids";
import { landItem, urlHolder } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { landNew, noteBlocksOf } from "./cell-items";
import { refuse } from "./cell-refusal";
import { landFields, liveRowOf } from "./cell-writes";

export interface SavedItem {
  readonly item: LiveItemRow;
  // false: the library already held the address, and this is that item
  readonly created: boolean;
}

// the live item a url's key names, if one does
const heldItem = (scope: LandingScope, url: string): { readonly id: string } | null => {
  const key = urlKey(url);
  return key === null ? null : urlHolder(scope.db, key, null);
};

export interface SaveInput {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly facts: Pick<LibraryItemFields, "author" | "description" | "lang" | "published" | "site">;
  readonly article: readonly LibraryBlock[];
  readonly coverSha: string | null;
  readonly folderId: string | null;
  readonly note?: string | undefined;
  readonly savedAt: number;
  readonly tags: readonly string[];
}

// what a read page brings to an item, however it was read
type ReadPage = Pick<SaveInput, "article" | "coverSha" | "facts" | "title">;

// the words a save brought, read into note blocks; blank words are none
const noteOf = (codec: CellCodec, words: string | undefined): readonly BodyBlock[] =>
  words === undefined || words.trim() === "" ? [] : noteBlocksOf(codec, words);

// an item's fields once a page is read into it, however it reached the item: what the page said of
// itself where it said anything (a value it did not give never removes one an import gave), its
// cover where it brought one, the reading's own state, and its title (empty when it gave none) only
// over the address the item is still named by
export const withPage = (
  fields: LibraryItemFields,
  page: Pick<ReadPage, "coverSha" | "facts" | "title">,
  now: number,
): LibraryItemFields => {
  const { facts } = page;
  const named = fields.url !== null && fields.title === itemNameFromUrl(fields.url);
  return {
    ...withReading(fields, { at: now, kind: "read" }),
    author: facts.author ?? fields.author,
    coverSha: page.coverSha ?? fields.coverSha,
    description: facts.description ?? fields.description,
    lang: facts.lang ?? fields.lang,
    published: facts.published ?? fields.published,
    site: facts.site ?? fields.site,
    title: page.title !== "" && named ? page.title : fields.title,
  };
};

// a page no live item holds the address of, as a new read item
const newPage = (scope: LandingScope, input: SaveInput, note: readonly BodyBlock[]): LiveItemRow =>
  landNew(scope, {
    blocks: withArticle(note, input.article),
    fields: pageFields(input, scope.now),
    id: input.id,
  });

// A page read into an item: `fields` as the reading leaves them, and its article in place of the
// item's, a page that held none leaving the item's. A body its note writes takes no article here:
// the write is refused, and lands again once the note took it (`articleInNote`).
export const landRead = (
  scope: LandingScope,
  item: LiveStoredItem,
  page: Pick<ReadPage, "article"> & { readonly articleInNote: boolean },
  fields: LibraryItemFields,
): LiveItemRow => {
  if (page.article.length === 0 || page.articleInNote) {
    return landFields(scope, item, fields);
  }
  if (bodyWriter(item.body.home) === "note") {
    return refuse({ itemId: item.id, kind: "note-opened", seq: item.seq });
  }
  return landItem(scope, {
    before: item,
    fields,
    itemId: item.id,
    seed: withArticle(readSeedBlocks(scope.db, item.id), page.article),
  });
};

// whether an item still has its page to be read: no article yet, its reading waiting or failed
const awaitsRead = (item: LiveStoredItem): boolean => {
  const { state } = readingOf(item.fields);
  return (state === "pending" || state === "failed") && !item.body.digest.article;
};

// a page the device read: a new read item, or the item that holds its address as it stands, which
// takes a read that found an article only while it has none of its own to lose; a read that found
// none leaves a waiting item to the cloud's
export const savePage = (
  scope: LandingScope,
  codec: CellCodec,
  input: SaveInput & { readonly articleInNote: boolean },
): SavedItem => {
  const held = heldItem(scope, input.url);
  if (held === null) {
    return { created: true, item: newPage(scope, input, noteOf(codec, input.note)) };
  }
  const item = readLiveItem(scope.db, held.id);
  return item !== null && input.article.length > 0 && awaitsRead(item)
    ? {
        created: false,
        item: landRead(scope, item, input, withPage(item.fields, input, scope.now)),
      }
    : { created: false, item: liveRowOf(scope, held.id) };
};

export interface SaveLinkInput {
  readonly url: string;
  readonly id?: string | undefined;
  readonly note?: string | undefined;
  readonly folder?: FolderTarget | undefined;
  readonly savedAt?: number | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly title?: string | undefined;
}

// a link no live item holds the address of, as an unread stub, `pending`, which the cloud reads
// after the write
const newStub = (
  scope: LandingScope,
  ids: CellIds,
  input: SaveLinkInput,
  note: readonly BodyBlock[],
  folderId: string | null,
): LiveItemRow =>
  landNew(scope, {
    blocks: note,
    fields: stubFields({
      folderId,
      savedAt: input.savedAt ?? scope.now,
      tags: input.tags ?? [],
      title: input.title,
      url: input.url,
    }),
    id: input.id ?? ids.item(),
  });

// a url to read later: the item that holds it as it stands, else an unread stub
export const saveLink = (
  scope: LandingScope,
  codec: CellCodec,
  ids: CellIds,
  input: SaveLinkInput,
): SavedItem => {
  const held = heldItem(scope, input.url);
  if (held !== null) {
    return { created: false, item: liveRowOf(scope, held.id) };
  }
  const folderId = folderOfTarget(scope, input.folder, ids.item);
  const note = noteOf(codec, input.note);
  return { created: true, item: newStub(scope, ids, input, note, folderId ?? null) };
};
