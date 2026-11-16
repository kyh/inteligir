// Landing one item's change inside a write's transaction: every rule a write meets (the item's text
// cap, one live item per url, the files it names, the quota), then its rows, stamped with the
// write's one sequence number. Only what changed is written: the body's seed and text when the write
// brings one, the derived rows and the index row when the body or the fields moved. A note's own
// body is its object's to write, and lands here only as the projection it pushes (`./cell-notes`).

import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import { canonicalJson, utf8ByteLength } from "@repo/contract/library/canonical-json";
import { deriveBody, deriveItem } from "@repo/contract/library/derive-item";
import type { BodyBlock, ItemCard } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { and, eq, isNull, ne } from "drizzle-orm";

import { items } from "@repo/db/cell/schema";
import { bodyWriter, readBodyText, storeBodyText, storeSeed } from "./cell-body";
import { itemFilesOf, missingBlobs, storeItemBlobs } from "./cell-blobs";
import type { CellDb } from "./cell-db";
import type { MovedCollector } from "./cell-moved";
import { holdRoomFor } from "./cell-quota";
import { refuse } from "./cell-refusal";
import type { CellResult } from "./cell-refusal";
import { recordLanding } from "./change-sets";
import { storeSearchRow } from "../search/search-index";
import { storeItemRow, storeLinks, storeTags } from "./library-queries";
import type { ItemBody, LiveStoredItem } from "./library-queries";
import { LibraryRowError } from "./library-sql";

// an item's text, all its blocks' together; a block's own is the vocabulary's
export const ITEM_TEXT_MAX_BYTES = 8 * 1024 * 1024;

// an item as a write answers it
export interface LiveItemRow {
  readonly card: ItemCard;
  readonly fields: LibraryItemFields;
  readonly id: string;
  readonly seq: number;
  readonly updatedAt: number;
}

// `seed`: the body the cell keeps for the item until its note opens, which an item the write makes
// always brings; null keeps the body where it is
export type Landing =
  | {
      readonly itemId: string;
      readonly before: null;
      readonly fields: LibraryItemFields;
      readonly seed: readonly BodyBlock[];
    }
  | {
      readonly itemId: string;
      readonly before: LiveStoredItem;
      readonly fields: LibraryItemFields;
      readonly seed: readonly BodyBlock[] | null;
    };

// what a write lands under: its one sequence number and time, and the change set of the agent's
// turn it is by, null for any other writer, each taken on the first landing so a write that lands
// nothing moves nothing; and what it moved, for the sockets
export interface LandingScope {
  readonly db: CellDb;
  readonly bytesCap: number;
  readonly now: number;
  readonly seq: () => number;
  readonly set: () => string | null;
  readonly moved: MovedCollector;
  // a part of the write that lands whole or not at all while the write goes on: what it wrote is
  // taken back when a rule refuses it, and the refusal answered
  readonly attempt: <T>(part: () => T) => CellResult<T>;
}

// the words a field holds, which grow the library as a block does. A stamp, a state, a place, a sha
// and a failed reading's sentence are left out: they swap one short value for another, and a full
// library must still take a delete, a move, a pin and the end of a reading
const fieldBytes = ({
  aliases,
  author,
  description,
  lang,
  originalName,
  properties,
  published,
  site,
  tags,
  title,
  url,
}: LibraryItemFields): number =>
  utf8ByteLength(
    canonicalJson({
      aliases,
      author,
      description,
      lang,
      originalName,
      properties,
      published,
      site,
      tags,
      title,
      url,
    }),
  );

// the other live item holding a url key, if one does
export const urlHolder = (
  db: CellDb,
  urlKey: string,
  itemId: string | null,
): { readonly id: string } | null =>
  db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.urlKey, urlKey),
        isNull(items.deletedAt),
        eq(items.purged, 0),
        itemId === null ? undefined : ne(items.id, itemId),
      ),
    )
    .limit(1)
    .get() ?? null;

const sameShas = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((sha) => right.has(sha));
};

// the body a landing leaves: a seed's derivation, or the body as it stands
interface LandedBody {
  readonly body: ItemBody;
  // a seed's blocks and text, which its rows take; null when the body stays as it is
  readonly seed: {
    readonly blocks: readonly BodyBlock[];
    readonly text: string;
    readonly links: ReturnType<typeof deriveBody>["links"];
  } | null;
}

const landedBody = (landing: Landing): LandedBody => {
  const { before, seed } = landing;
  if (seed === null) {
    if (before === null) {
      throw new LibraryRowError(`the item ${landing.itemId} is made with no body`);
    }
    return { body: before.body, seed: null };
  }
  if (before !== null && bodyWriter(before.body.home) === "note") {
    throw new LibraryRowError(`the item ${landing.itemId} has a note, which no seed replaces`);
  }
  const derived = deriveBody(seed);
  if (derived.textBytes > ITEM_TEXT_MAX_BYTES) {
    refuse({ kind: "too-large" });
  }
  return {
    body: { bytes: 0, digest: derived.digest, home: "seed", version: 0 },
    seed: { blocks: seed, links: derived.links, text: derived.text },
  };
};

// what the rules computed on the way: the item's derivation, its body and the files it names
interface Checked {
  readonly derived: ReturnType<typeof deriveItem>;
  readonly landed: LandedBody;
  readonly shas: readonly string[];
  readonly priorShas: readonly string[];
}

// every rule a landing meets, before anything is written: a refusal leaves nothing to roll back
const checkLanding = (scope: LandingScope, landing: Landing): Checked => {
  const { db } = scope;
  const { before, fields, itemId } = landing;
  if (!libraryItemFieldsSchema.validate(fields)) {
    refuse({ kind: "too-large" });
  }
  const landed = landedBody(landing);
  const derived = deriveItem(fields, landed.body.digest);
  if (
    derived.urlKey !== null &&
    fields.deletedAt === null &&
    urlHolder(db, derived.urlKey, itemId) !== null
  ) {
    refuse({ kind: "url-held" });
  }
  const shas = itemFilesOf(fields, landed.body.digest.files);
  const priorShas = before === null ? [] : itemFilesOf(before.fields, before.body.digest.files);
  const missing = missingBlobs(
    db,
    shas.filter((sha) => !priorShas.includes(sha)),
  );
  if (missing.length > 0) {
    refuse({ kind: "blob-missing", shas: missing });
  }
  if (before === null) {
    holdRoomFor(db, scope.bytesCap, fieldBytes(fields) + utf8ByteLength(landed.seed?.text ?? ""));
  }
  return { derived, landed, priorShas, shas };
};

// the row the item lands as; refuses a change no rule admits, before anything is written
export const landItem = (scope: LandingScope, landing: Landing): LiveItemRow => {
  const { db } = scope;
  const { before, fields, itemId } = landing;
  const { derived, landed, priorShas, shas } = checkLanding(scope, landing);
  const seq = scope.seq();
  recordLanding(
    db,
    { after: fields, before: before?.fields ?? null, itemId, setId: scope.set() },
    scope.now,
  );
  const stored = storeItemRow(db, {
    body: landed.body,
    card: derived.card,
    fields,
    id: itemId,
    seq,
    updatedAt: scope.now,
    urlKey: derived.urlKey,
  });
  if (!stored) {
    throw new LibraryRowError(`the item ${itemId} holds a row newer than the library's head`);
  }
  if (landed.seed !== null) {
    storeSeed(db, itemId, landed.seed.blocks);
    storeBodyText(db, itemId, landed.seed.text);
    storeLinks(db, itemId, landed.seed.links);
  }
  if (
    landed.seed !== null ||
    before === null ||
    canonicalJson(before.fields) !== canonicalJson(fields)
  ) {
    storeTags(db, itemId, derived.tags);
    storeSearchRow(db, itemId, {
      ...derived.search,
      body: landed.seed?.text ?? readBodyText(db, itemId),
    });
  }
  if (before === null || !sameShas(priorShas, shas)) {
    storeItemBlobs(db, itemId, shas, scope.now);
  }
  scope.moved.item(itemId, seq);
  // every writer of `deletedAt` lands here, and a note's door reads it for each socket as it
  // opens, so the sockets already open are opened again
  if (
    before !== null &&
    bodyWriter(before.body.home) === "note" &&
    (before.fields.deletedAt === null) !== (fields.deletedAt === null)
  ) {
    scope.moved.reopen(itemId);
  }
  return { card: derived.card, fields, id: itemId, seq, updatedAt: scope.now };
};
