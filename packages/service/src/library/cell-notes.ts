// The cell's side of each item's note (`../note/note-do`), every call inside one of the cell's
// transactions and none of them awaiting the note. A note's first load reads the body the cell
// kept (`seed` to `opening`) and confirms it once its own storage holds it (`opening` to `note`),
// so the seed outlives any abort in between; a body that went to its note never comes back to the
// cell. Each save pushes the body's projection, which lands the card, the index row, the literal
// text, the links, the files and the note's bytes, only over an older version, and joins no change
// set: typing is no change Undo takes back. The sockets hear of it only when what a listing shows
// moved.

import { and, eq, ne } from "drizzle-orm";

import { canonicalJson } from "@repo/contract/library/canonical-json";
import { deriveItem, itemCardSchema } from "@repo/contract/library/derive-item";
import type { DerivedLink, ItemCard } from "@repo/contract/library/derive-item";
import { items, links, noteSockets } from "@repo/db/cell/schema";

import type { NoteOpening, NoteProjection, ProjectAnswer, SeedAnswer } from "../note/note-wire";
import { dropSeed, readSeedBlocks, storeBodyText } from "./cell-body";
import { itemFilesOf, missingBlobs, storeItemBlobs } from "./cell-blobs";
import type { CellDb } from "./cell-db";
import { waitingPayloads } from "./cell-jobs";
import type { LandingScope } from "./cell-landing";
import { readItem, readLiveItem, storeLinks, storeSearchRow, storeTags } from "./library-queries";
import type { LiveStoredItem } from "./library-queries";
import { runPlan } from "./library-sql";

// a session's socket on an item's note: writable, read-only while the item is in Deleted, or none
// for an item the library does not hold; recorded, so the session's end closes it
export const openNote = (db: CellDb, sessionId: string, itemId: string): NoteOpening => {
  const item = readItem(db, itemId);
  if (item?.kind !== "live") {
    return "missing";
  }
  db.insert(noteSockets).values({ itemId, sessionId }).onConflictDoNothing().run();
  return item.fields.deletedAt === null ? "live" : "read";
};

// the items whose notes a session opened, forgotten as the session ends
export const takeSessionNotes = (db: CellDb, sessionId: string): string[] =>
  db
    .delete(noteSockets)
    .where(eq(noteSockets.sessionId, sessionId))
    .returning({ itemId: noteSockets.itemId })
    .all()
    .map((row) => row.itemId);

export const forgetNoteSockets = (db: CellDb, itemId: string): void => {
  db.delete(noteSockets).where(eq(noteSockets.itemId, itemId)).run();
};

// A note's first load: the seed is kept until the confirm, so a load that runs again after an
// abort reads it again; a note asking once its body went to a note lost that body, and never
// seeds over it.
export const readSeed = (db: CellDb, itemId: string): SeedAnswer => {
  const row = db
    .select({ home: items.bodyHome })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.purged, 0)))
    .get();
  if (row === undefined) {
    return { kind: "missing" };
  }
  if (row.home === "note") {
    return { kind: "claimed" };
  }
  if (row.home === "seed") {
    db.update(items).set({ bodyHome: "opening" }).where(eq(items.id, itemId)).run();
  }
  const blocks = readSeedBlocks(db, itemId);
  return blocks.length === 0 ? { kind: "empty" } : { blocks, kind: "seed" };
};

export const confirmSeed = (db: CellDb, itemId: string): void => {
  const landed = db
    .update(items)
    .set({ bodyHome: "note" })
    .where(and(eq(items.id, itemId), eq(items.bodyHome, "opening")))
    .returning({ id: items.id })
    .all();
  if (landed.length > 0) {
    dropSeed(db, itemId);
  }
};

// whether an item's body is its note's to write: once the note has read its seed
export const bodyInNote = (item: LiveStoredItem): boolean => item.body.home !== "seed";

// read through the card's schema, so a card built here and one read from its row compare alike
const sameCard = (a: ItemCard, b: ItemCard): boolean =>
  canonicalJson(itemCardSchema.parse(a)) === canonicalJson(itemCardSchema.parse(b));

const linkKey = (link: DerivedLink): string => link.targetId ?? `url:${link.targetKey}`;

const linksMoved = (db: CellDb, itemId: string, next: readonly DerivedLink[]): boolean => {
  const held = db
    .select({ targetId: links.targetId, targetKey: links.targetKey })
    .from(links)
    .where(eq(links.sourceId, itemId))
    .all()
    .map((row) => row.targetId ?? `url:${row.targetKey ?? ""}`)
    .toSorted();
  const wanted = next.map(linkKey).toSorted();
  return canonicalJson(held) !== canonicalJson(wanted);
};

// The body a note pushed, over the one the cell holds when it is newer. Files the library does not
// hold are left out of the item's files, as an embed of bytes never uploaded names nothing.
export const landProjection = (
  scope: LandingScope,
  itemId: string,
  projection: NoteProjection,
): ProjectAnswer => {
  const { db } = scope.storage;
  const item = readLiveItem(db, itemId);
  if (item === null) {
    return "gone";
  }
  if (!bodyInNote(item) || projection.version <= item.body.version) {
    return "stale";
  }
  const derived = deriveItem(item.fields, projection.digest);
  const named = itemFilesOf(item.fields, projection.digest.files);
  const unheld = new Set(missingBlobs(db, named));
  const shas = named.filter((sha) => !unheld.has(sha));
  const prior = itemFilesOf(item.fields, item.body.digest.files);
  const filesMoved = canonicalJson(shas.toSorted()) !== canonicalJson(prior.toSorted());
  const tagsMoved = canonicalJson(projection.digest.tags) !== canonicalJson(item.body.digest.tags);
  const linksChanged = linksMoved(db, itemId, projection.links);
  const moved = filesMoved || tagsMoved || linksChanged || !sameCard(derived.card, item.card);
  const seq = moved ? scope.seq() : item.seq;
  db.update(items)
    .set({
      bodyBytes: projection.bytes,
      bodyDigest: JSON.stringify(projection.digest),
      bodyVersion: projection.version,
      card: JSON.stringify(derived.card),
      seq,
      updatedAt: moved ? scope.now : item.updatedAt,
    })
    .where(eq(items.id, itemId))
    .run();
  storeBodyText(db, itemId, projection.text);
  runPlan(scope.storage, storeSearchRow(itemId, { ...derived.search, body: projection.text }));
  if (linksChanged) {
    storeLinks(db, itemId, projection.links);
  }
  if (tagsMoved) {
    storeTags(db, itemId, derived.tags);
  }
  if (filesMoved) {
    storeItemBlobs(db, itemId, shas, scope.now);
  }
  if (moved) {
    scope.moved.item(itemId, seq);
  }
  return "landed";
};

// every item whose note holds a body: a live item's that opened, and a purged one's the alarm has
// yet to empty
export const notesHeld = (db: CellDb): string[] => [
  ...new Set([
    ...db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.purged, 0), ne(items.bodyHome, "seed")))
      .all()
      .map((row) => row.id),
    ...waitingPayloads(db, "note-purge").map((payload) => payload.itemId),
  ]),
];
