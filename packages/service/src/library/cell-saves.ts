// Saving a web address: one url, one item. A save of an address a live item holds answers that
// item as it stands and writes nothing, unless it is a page a device read itself (the extension)
// and the item has no article yet, its reading still waiting or failed: then the read lands on it
// as a reading does. Only an address no live item holds makes an item. A page a device read lands
// read; one saved to read later lands at once as an unread stub, `pending`, which the cloud reads
// afterwards. The words saved with it go in the new item's note. An item whose note has opened
// takes a page's article in its note, which the caller sends there before the write
// (`replaceArticle`), so the write lands only the fields.

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { applyFieldOps } from "@repo/contract/library/field-ops";
import type { FieldOp } from "@repo/contract/library/field-ops";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { pageFields, stubFields } from "@repo/contract/library/item-makes";
import { readLiveItem } from "./library-queries";
import type { LiveStoredItem } from "./library-queries";
import { itemNameFromUrl } from "@repo/contract/items/item-name";
import { urlKey } from "@repo/contract/items/item-url";

import { withArticle } from "../note/article-body";
import { readSeedBlocks } from "./cell-body";
import type { CellCodec } from "./cell-codec";
import { folderOfTarget } from "./cell-folders";
import type { FolderTarget } from "./cell-folders";
import type { CellIds } from "./cell-ids";
import { landItem, urlHolder } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { landNew, noteBlocksOf } from "./cell-items";
import { refuse } from "./cell-refusal";
import { landWrite, liveRowOf } from "./cell-writes";

export interface SavedItem {
  readonly item: LiveItemRow;
  // false: the library already held the address, and this is that item
  readonly created: boolean;
}

// the live item a url's key names, if one does
const heldItem = (scope: LandingScope, url: string): { readonly id: string } | null => {
  const key = urlKey(url);
  return key === null ? null : urlHolder(scope.storage.db, key, null);
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
const noteOf = (
  scope: LandingScope,
  codec: CellCodec,
  words: string | undefined,
): readonly BodyBlock[] =>
  words === undefined || words.trim() === "" ? [] : noteBlocksOf(scope, codec, words);

// a field op that changes something; one whose value is its base is left out
export const changes = (op: FieldOp): boolean => op.op !== "set" || op.base !== op.value;

const FACT_FIELDS = ["author", "description", "lang", "published", "site"] as const;

// the fields a read page sets, however it reached the item: what it said of itself where it said
// anything (a value it did not give never removes one an import gave), its cover where it brought
// one, the reading's own state, and its title (empty when it gave none) only over the address the
// item is still named by
export const readOps = (fields: LibraryItemFields, now: number): FieldOp[] => [
  { base: fields.fetchError, field: "fetchError", op: "set", value: null },
  { base: fields.fetchState, field: "fetchState", op: "set", value: "filled" },
  { base: fields.fetchedAt, field: "fetchedAt", op: "set", value: now },
];

export const pageFieldOps = (
  fields: LibraryItemFields,
  page: Pick<ReadPage, "coverSha" | "facts" | "title">,
  now: number,
): FieldOp[] => {
  const ops: FieldOp[] = [];
  for (const field of FACT_FIELDS) {
    const value = page.facts[field];
    if (value !== null) {
      ops.push({ base: fields[field], field, op: "set", value });
    }
  }
  if (page.coverSha !== null) {
    ops.push({ base: fields.coverSha, field: "coverSha", op: "set", value: page.coverSha });
  }
  ops.push(...readOps(fields, now));
  if (page.title !== "" && fields.url !== null && fields.title === itemNameFromUrl(fields.url)) {
    ops.push({ base: fields.title, field: "title", op: "set", value: page.title });
  }
  return ops.filter(changes);
};

// a page no live item holds the address of, as a new read item
const newPage = (scope: LandingScope, input: SaveInput, note: readonly BodyBlock[]): LiveItemRow =>
  landNew(scope, {
    blocks: withArticle(note, input.article),
    fields: pageFields(input, scope.now),
    id: input.id,
  });

// A page read into an item: the fields `fieldOps` set, and its article in place of the item's, a
// page that held none leaving the item's. A note's article is the note's to replace, which the
// caller did before this write (`articleInNote`); an item whose note opened since lands nothing
// here, so the caller tries again by the note.
export const landRead = (
  scope: LandingScope,
  item: LiveStoredItem,
  page: Pick<ReadPage, "article"> & { readonly articleInNote: boolean },
  fieldOps: readonly FieldOp[],
): LiveItemRow => {
  if (page.article.length === 0 || page.articleInNote) {
    return landWrite(scope, { itemId: item.id, ops: fieldOps });
  }
  if (item.body.home === "note") {
    return refuse({ kind: "note-opened", itemId: item.id });
  }
  const outcome = applyFieldOps(item.fields, fieldOps);
  if (outcome.kind !== "applied") {
    return refuse({ kind: "too-large" });
  }
  return landItem(scope, {
    before: item,
    fields: outcome.fields,
    itemId: item.id,
    seed: withArticle(readSeedBlocks(scope.storage.db, item.id), page.article),
  });
};

// whether an item still has its page to be read: no article yet, its reading waiting or failed
const awaitsRead = (item: LiveStoredItem): boolean =>
  (item.fields.fetchState === "pending" || item.fields.fetchState === "failed") &&
  !item.body.digest.article;

// the item a device's read of `url` would land on, its article bound for the item's note: one that
// holds the address, waits for its page and has opened its note
export const pageForNote = (
  scope: Pick<LandingScope, "storage">,
  url: string,
): LiveStoredItem | null => {
  const key = urlKey(url);
  const holder = key === null ? null : urlHolder(scope.storage.db, key, null);
  const item = holder === null ? null : readLiveItem(scope.storage.db, holder.id);
  return item !== null && item.body.home === "note" && awaitsRead(item) ? item : null;
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
    return { created: true, item: newPage(scope, input, noteOf(scope, codec, input.note)) };
  }
  const item = readLiveItem(scope.storage.db, held.id);
  return item !== null && input.article.length > 0 && awaitsRead(item)
    ? {
        created: false,
        item: landRead(scope, item, input, pageFieldOps(item.fields, input, scope.now)),
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
  const note = noteOf(scope, codec, input.note);
  return { created: true, item: newStub(scope, ids, input, note, folderId ?? null) };
};
