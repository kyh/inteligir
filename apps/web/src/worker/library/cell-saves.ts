// Saving a web address: one url, one item (rule R22). A save of an address a live item holds
// folds onto that item, adding what it brings, and only an address no live item holds makes one.
// A page a device read itself (the extension, the share sheet) lands read, its article replacing
// the item's and the item's highlights placed again in it by their quotes, since the markers the
// old article held went with it; a read that found no article leaves the item's. One saved to
// read later lands at once as an unread stub, `pending`, which the cloud reads afterwards. The
// passage the person had selected is kept as a highlight on the page.

import { blockHash } from "@repo/notes/library/block-hash";
import { applyOps } from "@repo/notes/library/block-ops";
import type { ItemState, LibraryOp } from "@repo/notes/library/block-ops";
import { compareText, ordsBetween } from "@repo/notes/library/block-order";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { readItemState } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import { itemNameFromUrl } from "@repo/notes/items/item-name";
import { cleanUrl, kindForUrl, urlKey } from "@repo/notes/items/item-url";

import type { CellActor } from "./cell-actor";
import { readAnnotationRows } from "./cell-annotations";
import type { AnnotationRows } from "./cell-annotations";
import type { CellCodec } from "./cell-codec";
import { folderOfTarget } from "./cell-folders";
import type { FolderTarget } from "./cell-folders";
import type { CellIds } from "./cell-ids";
import { urlHolder } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { bareHighlight, blankFields, landNew, noteBlocksOf, placeQuotes } from "./cell-items";
import type { PlacedBlock, PlacingQuote } from "./cell-items";
import { refuse } from "./cell-refusal";
import { landWrite } from "./cell-writes";

export interface SavedItem {
  readonly item: LiveItemRow;
  readonly folded: boolean;
}

type HeldItem = ItemState & { readonly id: string };

// the live item a url's key names, if one does
const heldItem = (scope: LandingScope, url: string): HeldItem | null => {
  const key = urlKey(url);
  const holder = key === null ? null : urlHolder(scope.storage, key, null);
  const state = holder === null ? null : runPlan(scope.storage, readItemState(holder.id));
  return holder === null || state === null ? null : { ...state, id: holder.id };
};

const tagKey = (tag: string): string => tag.toLowerCase();

// the item's tags with the save's added, as a list op merges them
const tagsOp = (fields: LibraryItemFields, tags: readonly string[]): LibraryOp[] => {
  const held = new Set(fields.tags.map(tagKey));
  const added = [...new Set(tags)].filter((tag) => !held.has(tagKey(tag)));
  return added.length === 0
    ? []
    : [{ base: fields.tags, op: "tags", value: [...fields.tags, ...added] }];
};

// the highlights of an item that keep a passage, oldest first
export const quotesOf = (rows: AnnotationRows): PlacingQuote[] =>
  [...rows.values()]
    .toSorted((a, b) => a.createdAt - b.createdAt || compareText(a.id, b.id))
    .flatMap((row) =>
      row.deletedAt === null && row.parentId === null && row.quote !== null
        ? [{ id: row.id, occurrence: row.occurrence ?? undefined, quote: row.quote }]
        : [],
    );

// the passage a person had selected, unless a highlight of the item already keeps that quote
const selectionToKeep = (rows: AnnotationRows, selection: string | null): string | null =>
  selection !== null && quotesOf(rows).some((held) => held.quote === selection) ? null : selection;

export interface SaveInput {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly facts: Pick<LibraryItemFields, "author" | "description" | "lang" | "published" | "site">;
  readonly article: readonly { readonly block: LibraryBlock; readonly ord: string }[];
  readonly coverSha: string | null;
  readonly copySha: string | null;
  readonly folderId: string | null;
  readonly savedAt: number;
  readonly tags: readonly string[];
  readonly selection: string | null;
}

// what a page brings to the item that holds its address, however it was read
export type ReadPage = Pick<
  SaveInput,
  "article" | "copySha" | "coverSha" | "facts" | "folderId" | "tags" | "title"
>;

const articleOf = (input: ReadPage): PlacedBlock[] =>
  input.article.map(({ block, ord }) => ({ block, ord, section: "article" }));

// a field op that changes something; one whose value is its base is left out
const changes = (op: LibraryOp): boolean => op.op !== "set" || op.base !== op.value;

// the read page's facts over the item's: what the fill owns, the page's title for a stub never
// read (its own was the address's placeholder), and the page's files where it brought any
const factOps = (state: ItemState, input: ReadPage, now: number): LibraryOp[] => {
  const { fields } = state;
  const { facts } = input;
  const title = fields.fetchState === "filled" || input.title === "" ? fields.title : input.title;
  const ops: LibraryOp[] = [
    { base: fields.author, field: "author", op: "set", value: facts.author },
    { base: fields.description, field: "description", op: "set", value: facts.description },
    { base: fields.lang, field: "lang", op: "set", value: facts.lang },
    { base: fields.published, field: "published", op: "set", value: facts.published },
    { base: fields.site, field: "site", op: "set", value: facts.site },
    {
      base: fields.copySha,
      field: "copySha",
      op: "set",
      value: input.copySha ?? fields.copySha,
    },
    {
      base: fields.coverSha,
      field: "coverSha",
      op: "set",
      value: input.coverSha ?? fields.coverSha,
    },
    { base: fields.fetchError, field: "fetchError", op: "set", value: null },
    { base: fields.fetchState, field: "fetchState", op: "set", value: "filled" },
    { base: fields.fetchedAt, field: "fetchedAt", op: "set", value: now },
    {
      base: fields.folderId,
      field: "folderId",
      op: "set",
      value: fields.folderId ?? input.folderId,
    },
    { base: fields.title, field: "title", op: "set", value: title },
  ];
  return ops.filter(changes);
};

type Highlight = { readonly id: string; readonly quote: string } | null;

// a page no live item holds the address of, as a new read item, the selection's markers already
// in its article
const newPage = (
  scope: LandingScope,
  actor: CellActor,
  codec: CellCodec,
  input: SaveInput,
  highlight: Highlight,
): LiveItemRow => {
  const fields: LibraryItemFields = {
    ...blankFields(scope.now),
    ...input.facts,
    copySha: input.copySha,
    coverSha: input.coverSha,
    fetchState: "filled",
    fetchedAt: scope.now,
    folderId: input.folderId,
    kind: kindForUrl(input.url),
    savedAt: input.savedAt,
    tags: [...new Set(input.tags)],
    title: input.title === "" ? itemNameFromUrl(input.url) : input.title,
    url: cleanUrl(input.url),
  };
  let state: ItemState = {
    blocks: new Map(
      articleOf(input).map((placed) => [
        placed.block.id,
        { ...placed, hash: blockHash(placed.block) },
      ]),
    ),
    fields,
  };
  if (highlight !== null) {
    const placement = applyOps(state, placeQuotes(state, codec, [highlight]).ops);
    if (placement.kind !== "applied") {
      throw new Error("a highlight's markers did not land on the blocks they were placed on");
    }
    ({ state } = placement);
  }
  return landNew(scope, actor, {
    annotations: highlight === null ? [] : [bareHighlight(scope, highlight)],
    blocks: [...state.blocks.values()],
    fields,
    id: input.id,
  });
};

// the ops that put a note's blocks after the person's own, keyed past the last of them
const appendedNote = (
  held: HeldItem,
  note: readonly { readonly block: LibraryBlock }[],
): LibraryOp[] => {
  const last =
    [...held.blocks.values()]
      .filter((stored) => stored.section === "note")
      .map((stored) => stored.ord)
      .toSorted(compareText)
      .at(-1) ?? null;
  const keys = ordsBetween(last, null, note.length);
  return note.map((placed, index): LibraryOp => {
    const ord = keys[index];
    return ord === undefined
      ? refuse({ kind: "too-large" })
      : { block: placed.block, op: "insert", ord, section: "note" };
  });
};

// a page onto the item holding its address: its article replaces the item's, unless the read
// found none, and the item's highlights are placed again in it; its facts land where the fill
// owns them, its tags join the item's, and a note it brings goes after the item's own
export const foldPage = (
  scope: LandingScope,
  actor: CellActor,
  codec: CellCodec,
  held: HeldItem,
  rows: AnnotationRows,
  input: ReadPage,
  highlight: Highlight = null,
  note: readonly { readonly block: LibraryBlock }[] = [],
): LiveItemRow => {
  const replacing = input.article.length > 0;
  const ops: LibraryOp[] = [
    ...(replacing
      ? [
          ...[...held.blocks.values()]
            .filter((stored) => stored.section === "article")
            .map((stored): LibraryOp => ({
              baseHash: stored.hash,
              blockId: stored.block.id,
              op: "drop",
            })),
          ...articleOf(input).map((placed): LibraryOp => ({ ...placed, op: "insert" })),
        ]
      : []),
    ...factOps(held, input, scope.now),
    ...tagsOp(held.fields, input.tags),
    ...appendedNote(held, note),
  ];
  // a highlight whose markers the note holds stays where it is (`placeQuotes`)
  const quotes = [...(replacing ? quotesOf(rows) : []), ...(highlight === null ? [] : [highlight])];
  const read = quotes.length === 0 ? null : applyOps(held, ops);
  if (read?.kind === "applied") {
    ops.push(...placeQuotes(read.state, codec, quotes).ops);
  }
  return landWrite(scope, actor, {
    annotations: highlight === null ? [] : [bareHighlight(scope, highlight)],
    itemId: held.id,
    ops,
  });
};

// a page the device read: onto the item that holds its address, or as a new read item
export const savePage = (
  scope: LandingScope,
  actor: CellActor,
  codec: CellCodec,
  ids: CellIds,
  input: SaveInput,
): SavedItem => {
  const held = heldItem(scope, input.url);
  const rows: AnnotationRows =
    held === null ? new Map() : readAnnotationRows(scope.storage, held.id);
  const selection = selectionToKeep(rows, input.selection);
  const highlight = selection === null ? null : { id: ids.annotation(), quote: selection };
  return held === null
    ? { folded: false, item: newPage(scope, actor, codec, input, highlight) }
    : { folded: true, item: foldPage(scope, actor, codec, held, rows, input, highlight) };
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

// a url to read later: the item that holds it gains the tags, the note and the folder; else an
// unread stub lands, `pending`, which the cloud reads after the write
export const saveLink = (
  scope: LandingScope,
  actor: CellActor,
  codec: CellCodec,
  ids: CellIds,
  input: SaveLinkInput,
): SavedItem => {
  const folderId = folderOfTarget(scope, input.folder, ids.item);
  const note =
    input.note === undefined || input.note.trim() === ""
      ? null
      : noteBlocksOf(scope, codec, input.note);
  const highlights = note?.highlights ?? [];
  const held = heldItem(scope, input.url);
  if (held === null) {
    const item = landNew(scope, actor, {
      annotations: highlights,
      blocks: note?.blocks ?? [],
      fields: {
        ...blankFields(scope.now),
        fetchState: "pending",
        folderId: folderId ?? null,
        kind: kindForUrl(input.url),
        savedAt: input.savedAt ?? scope.now,
        tags: [...new Set(input.tags)],
        title: input.title ?? itemNameFromUrl(input.url),
        url: cleanUrl(input.url),
      },
      id: input.id ?? ids.item(),
    });
    return { folded: false, item };
  }
  const ops: LibraryOp[] = [
    ...tagsOp(held.fields, input.tags ?? []),
    ...(folderId === undefined || folderId === held.fields.folderId
      ? []
      : [{ base: held.fields.folderId, field: "folderId", op: "set", value: folderId } as const]),
    ...(note === null ? [] : appendedNote(held, note.blocks)),
  ];
  const item = landWrite(scope, actor, { annotations: highlights, itemId: held.id, ops });
  return { folded: true, item };
};
