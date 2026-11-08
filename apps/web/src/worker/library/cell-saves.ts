// Saving a web address: one url, one item. A save of an address a live item holds answers that
// item as it stands and writes nothing, unless it is a page a device read itself (the extension)
// and the item has no article yet, its reading still waiting or failed: then the read lands on it
// as a reading does. Only an address no live item holds makes an item. A page a device read lands
// read; one saved to read later lands at once as an unread stub, `pending`, which the cloud reads
// afterwards. The passage the person had selected is kept as a highlight on the page, and the
// words saved with it go in the new item's note.

import { blockHash } from "@repo/notes/library/block-hash";
import { applyOps } from "@repo/notes/library/block-ops";
import type { ItemState, LibraryOp } from "@repo/notes/library/block-ops";
import { compareText } from "@repo/notes/library/block-order";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { pageFields, stubFields } from "@repo/notes/library/item-makes";
import { readItemState } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import { itemNameFromUrl } from "@repo/notes/items/item-name";
import { urlKey } from "@repo/notes/items/item-url";

import type { CellActor } from "./cell-actor";
import { readAnnotationRows } from "./cell-annotations";
import type { AnnotationRows } from "./cell-annotations";
import type { CellCodec } from "./cell-codec";
import { folderOfTarget } from "./cell-folders";
import type { FolderTarget } from "./cell-folders";
import type { CellIds } from "./cell-ids";
import { urlHolder } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { bareHighlight, landNew, noteBlocksOf, placeQuotes } from "./cell-items";
import type { MarkdownBlocks, PlacedBlock, PlacingQuote } from "./cell-items";
import { landWrite, liveRowOf } from "./cell-writes";

export interface SavedItem {
  readonly item: LiveItemRow;
  // false: the library already held the address, and this is that item
  readonly created: boolean;
}

// the live item a url's key names, if one does
const heldItem = (scope: LandingScope, url: string): { readonly id: string } | null => {
  const key = urlKey(url);
  return key === null ? null : urlHolder(scope.storage, key, null);
};

// the highlights of an item that keep a passage, oldest first
const quotesOf = (rows: AnnotationRows): PlacingQuote[] =>
  [...rows.values()]
    .toSorted((a, b) => a.createdAt - b.createdAt || compareText(a.id, b.id))
    .flatMap((row) =>
      row.deletedAt === null && row.parentId === null && row.quote !== null
        ? [{ id: row.id, occurrence: row.occurrence ?? undefined, quote: row.quote }]
        : [],
    );

export interface SaveInput {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly facts: Pick<LibraryItemFields, "author" | "description" | "lang" | "published" | "site">;
  readonly article: readonly { readonly block: LibraryBlock; readonly ord: string }[];
  readonly coverSha: string | null;
  readonly folderId: string | null;
  readonly note?: string | undefined;
  readonly savedAt: number;
  readonly tags: readonly string[];
  readonly selection: string | null;
}

// what a read page brings to an item, however it was read
type ReadPage = Pick<SaveInput, "article" | "coverSha" | "facts" | "title">;

const articleOf = (input: Pick<ReadPage, "article">): PlacedBlock[] =>
  input.article.map(({ block, ord }) => ({ block, ord, section: "article" }));

// the ops that put a page's article in place of the item's; a page that held none leaves the
// item's
const articleOps = (state: ItemState, page: Pick<ReadPage, "article">): LibraryOp[] =>
  page.article.length === 0
    ? []
    : [
        ...[...state.blocks.values()]
          .filter((stored) => stored.section === "article")
          .map((stored): LibraryOp => ({
            baseHash: stored.hash,
            blockId: stored.block.id,
            op: "drop",
          })),
        ...articleOf(page).map((placed): LibraryOp => ({ ...placed, op: "insert" })),
      ];

// the words a save brought, read into note blocks; blank words are none
const noteOf = (
  scope: LandingScope,
  codec: CellCodec,
  words: string | undefined,
): MarkdownBlocks | null =>
  words === undefined || words.trim() === "" ? null : noteBlocksOf(scope, codec, words);

// the ops that place `quotes` where the item's text holds them once `ops` land
const quoteOps = (
  state: ItemState,
  codec: CellCodec,
  ops: readonly LibraryOp[],
  quotes: readonly PlacingQuote[],
): readonly LibraryOp[] => {
  const read = quotes.length === 0 ? null : applyOps(state, ops);
  return read?.kind === "applied" ? placeQuotes(read.state, codec, quotes).ops : [];
};

// a field op that changes something; one whose value is its base is left out
export const changes = (op: LibraryOp): boolean => op.op !== "set" || op.base !== op.value;

const FACT_FIELDS = ["author", "description", "lang", "published", "site"] as const;

// the fields a read page sets, however it reached the item: what it said of itself where it said
// anything (a value it did not give never removes one an import gave), its cover where it brought
// one, the reading's own state, and its title (empty when it gave none) only over the address the
// item is still named by
export const readOps = (fields: LibraryItemFields, now: number): LibraryOp[] => [
  { base: fields.fetchError, field: "fetchError", op: "set", value: null },
  { base: fields.fetchState, field: "fetchState", op: "set", value: "filled" },
  { base: fields.fetchedAt, field: "fetchedAt", op: "set", value: now },
];

export const pageFieldOps = (
  fields: LibraryItemFields,
  page: Pick<ReadPage, "coverSha" | "facts" | "title">,
  now: number,
): LibraryOp[] => {
  const ops: LibraryOp[] = [];
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

type Highlight = { readonly id: string; readonly quote: string } | null;

// a page no live item holds the address of, as a new read item, the selection's markers already
// in its article
const newPage = (
  scope: LandingScope,
  actor: CellActor,
  codec: CellCodec,
  input: SaveInput,
  highlight: Highlight,
  note: MarkdownBlocks | null,
): LiveItemRow => {
  const fields = pageFields(input, scope.now);
  let state: ItemState = {
    blocks: new Map(
      [...articleOf(input), ...(note?.blocks ?? [])].map((placed) => [
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
    annotations: [
      ...(note?.highlights ?? []),
      ...(highlight === null ? [] : [bareHighlight(scope, highlight)]),
    ],
    blocks: [...state.blocks.values()],
    fields,
    id: input.id,
  });
};

// a page read into an item: its article in place of the item's and the fields `fieldOps` set, the
// item's highlights placed again in the article by their quotes, since the markers the old article
// held went with it; one the note holds stays where it is
export const landRead = (
  scope: LandingScope,
  actor: CellActor,
  codec: CellCodec,
  item: { readonly id: string; readonly state: ItemState },
  page: Pick<ReadPage, "article">,
  fieldOps: readonly LibraryOp[],
): LiveItemRow => {
  const ops = [...articleOps(item.state, page), ...fieldOps];
  const quotes =
    page.article.length === 0 ? [] : quotesOf(readAnnotationRows(scope.storage, item.id));
  return landWrite(scope, actor, {
    itemId: item.id,
    ops: [...ops, ...quoteOps(item.state, codec, ops, quotes)],
  });
};

// whether an item still has its page to be read: no article yet, its reading waiting or failed
const awaitsRead = (state: ItemState): boolean =>
  (state.fields.fetchState === "pending" || state.fields.fetchState === "failed") &&
  ![...state.blocks.values()].some((stored) => stored.section === "article");

// a page the device read: a new read item, or the item that holds its address as it stands, which
// takes a read that found an article only while it has none of its own to lose; a read that found
// none leaves a waiting item to the cloud's
export const savePage = (
  scope: LandingScope,
  actor: CellActor,
  codec: CellCodec,
  ids: CellIds,
  input: SaveInput,
): SavedItem => {
  const held = heldItem(scope, input.url);
  if (held === null) {
    const highlight =
      input.selection === null ? null : { id: ids.annotation(), quote: input.selection };
    const note = noteOf(scope, codec, input.note);
    return { created: true, item: newPage(scope, actor, codec, input, highlight, note) };
  }
  const state = runPlan(scope.storage, readItemState(held.id));
  return state !== null && input.article.length > 0 && awaitsRead(state)
    ? {
        created: false,
        item: landRead(
          scope,
          actor,
          codec,
          { id: held.id, state },
          input,
          pageFieldOps(state.fields, input, scope.now),
        ),
      }
    : { created: false, item: liveRowOf(scope, held.id) };
};

export interface SaveLinkInput {
  readonly url: string;
  readonly id?: string | undefined;
  readonly note?: string | undefined;
  readonly folder?: FolderTarget | undefined;
  readonly savedAt?: number | undefined;
  readonly selection?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly title?: string | undefined;
}

// a link no live item holds the address of, as an unread stub, `pending`, which the cloud reads
// after the write; the passage the person had selected waits as a bare highlight until the
// reading holds its text (`landFill`)
const newStub = (
  scope: LandingScope,
  actor: CellActor,
  ids: CellIds,
  input: SaveLinkInput,
  note: MarkdownBlocks | null,
  folderId: string | null,
): LiveItemRow => {
  const selected =
    input.selection === undefined
      ? []
      : [bareHighlight(scope, { id: ids.annotation(), quote: input.selection })];
  return landNew(scope, actor, {
    annotations: [...(note?.highlights ?? []), ...selected],
    blocks: note?.blocks ?? [],
    fields: stubFields({
      folderId,
      savedAt: input.savedAt ?? scope.now,
      tags: input.tags ?? [],
      title: input.title,
      url: input.url,
    }),
    id: input.id ?? ids.item(),
  });
};

// a url to read later: the item that holds it as it stands, else an unread stub
export const saveLink = (
  scope: LandingScope,
  actor: CellActor,
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
  return { created: true, item: newStub(scope, actor, ids, input, note, folderId ?? null) };
};
