// The files an item holds, by the sha R2 keeps them under (`acct/<userId>/b/<sha>`): a write may
// name only a file the library already holds, and the file's row lands once the bytes do. A device
// asks for room before it uploads, the cell holds it against the quota, and once the upload is in
// R2 the cell reads its size there and lands the row; room held past an hour with no upload is let
// go by the alarm, and so is what such an upload, or one the cell refused, left in R2. A file stays
// while an item names it or any change set does (`change_set_blobs`), and once nothing does or
// will it is let go: when the import that kept it ends, at the alarm's next run after the reading
// that kept it lands nowhere or the last change set naming it went, and by the alarm a day after
// it landed or an item stopped naming it otherwise, but never while an import runs, whose plan may
// name it.

import { and, eq, exists, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { blobs, blobUploads, itemBlobs, jobs } from "@repo/db/cell/schema";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { readCount, writeMeta } from "./library-queries";
import { chunkStatement } from "./library-sql";
import type { SqlStatements } from "./library-sql";

import { excluded, insertChunks, listChunks } from "./cell-db";
import type { CellDb } from "./cell-db";
import { dropJob, ensureJob, scheduleJob } from "./cell-jobs";
import { addFileBytes, holdRoomFor } from "./cell-quota";
import type { CellStorage } from "./cell-storage";

export const blobKey = (accountId: string, sha: string): string => `acct/${accountId}/b/${sha}`;

// everything R2 holds for one account, which its deletion empties
export const accountBlobPrefix = (accountId: string): string => `acct/${accountId}/`;

export const fieldFilesOf = ({ coverSha, originalSha }: LibraryItemFields): string[] =>
  [originalSha, coverSha].filter((sha) => sha !== null);

// every file an item names: its original and cover by field, and each image, video or file its
// body embeds, as its digest last read the body
export const itemFilesOf = (fields: LibraryItemFields, bodyFiles: readonly string[]): string[] => [
  ...new Set([...fieldFilesOf(fields), ...bodyFiles]),
];

const shaRowSchema = z.object({ sha256: z.string() });

const heldShas = (db: CellDb, shas: readonly string[]): Set<string> => {
  const held = new Set<string>();
  for (const chunk of listChunks(shas)) {
    for (const row of db
      .select({ sha256: blobs.sha256 })
      .from(blobs)
      .where(inArray(blobs.sha256, chunk))
      .all()) {
      held.add(row.sha256);
    }
  }
  return held;
};

// of `shas`, those the library holds no file for
export const missingBlobs = (db: CellDb, shas: readonly string[]): string[] => {
  const unique = [...new Set(shas)];
  const held = heldShas(db, unique);
  return unique.filter((sha) => !held.has(sha)).toSorted();
};

// how many items name each file, recounted for the files a write touched
const recountRefs = (db: CellDb, shas: readonly string[]): void => {
  for (const chunk of listChunks([...new Set(shas)])) {
    db.update(blobs)
      .set({ refs: db.$count(itemBlobs, eq(itemBlobs.sha256, blobs.sha256)) })
      .where(inArray(blobs.sha256, chunk))
      .run();
  }
};

// ---- files change sets name ----

// what a fields part or a block version of the item names, kept with it
export const keepSetFiles = (
  statements: SqlStatements,
  itemId: string,
  hash: string,
  shas: readonly string[],
): void => {
  for (const statement of chunkStatement({
    each: "(?, ?, ?)",
    head: "INSERT INTO change_set_blobs (item_id, hash, sha256) VALUES ",
    rows: [...new Set(shas)].map((sha) => [itemId, hash, sha]),
    separator: ", ",
    tail: " ON CONFLICT DO NOTHING",
  })) {
    statements.run(statement.sql, statement.params);
  }
};

// ---- files nothing names ----

// how long a file no item names waits for one, longer than any device's upload and its write
const UNNAMED_HOLD_MS = 24 * 60 * 60_000;

const unnamedJobId = (sha: string): string => `unnamed:${sha}`;

const unnamedJob = (sha: string) =>
  ({ id: unnamedJobId(sha), kind: "unnamed", payload: JSON.stringify({ sha }) }) as const;

// a file just landed, or one an item just stopped naming, waits for an item to name it
const awaitName = (db: CellDb, sha: string, now: number): void => {
  scheduleJob(db, unnamedJob(sha), now + UNNAMED_HOLD_MS);
};

// the alarm asks about a file at `at`: now once its last name went, later while something may
// still name it
export const awaitNameAgain = (db: CellDb, sha: string, at: number): void => {
  scheduleJob(db, unnamedJob(sha), at);
};

// parts and block versions of the item no change set names any more: the alarm's next run asks
// about what they named
export const dropSetFiles = (
  storage: CellStorage,
  itemId: string,
  hashes: readonly string[],
  now: number,
): void => {
  const shas = hashes.flatMap((hash) =>
    storage
      .all("DELETE FROM change_set_blobs WHERE item_id = ? AND hash = ? RETURNING sha256", [
        itemId,
        hash,
      ])
      .map((row) => shaRowSchema.parse(row).sha256),
  );
  for (const sha of new Set(shas)) {
    awaitNameAgain(storage.db, sha, now);
  }
};

// files that may name nothing now, asked about at the alarm's next run rather than at their day's
// end; one an item named since has no job left to move
export const hurryUnnamed = (db: CellDb, shas: readonly string[], now: number): void => {
  for (const sha of new Set(shas)) {
    db.update(jobs)
      .set({ nextAt: sql`min(${jobs.nextAt}, ${now})` })
      .where(eq(jobs.id, unnamedJobId(sha)))
      .run();
  }
};

// files an item names now, which no longer wait
const named = (db: CellDb, shas: readonly string[]): void => {
  for (const chunk of listChunks([...new Set(shas)].map(unnamedJobId))) {
    db.delete(jobs).where(inArray(jobs.id, chunk)).run();
  }
};

const deleteItemBlobs = (db: CellDb, itemId: string): string[] =>
  db
    .delete(itemBlobs)
    .where(eq(itemBlobs.itemId, itemId))
    .returning({ sha256: itemBlobs.sha256 })
    .all()
    .map((row) => row.sha256);

export const storeItemBlobs = (
  db: CellDb,
  itemId: string,
  shas: readonly string[],
  now: number,
): void => {
  named(db, shas);
  const before = deleteItemBlobs(db, itemId);
  for (const chunk of insertChunks(
    itemBlobs,
    shas.map((sha256) => ({ itemId, sha256 })),
  )) {
    db.insert(itemBlobs).values(chunk).run();
  }
  recountRefs(db, [...before, ...shas]);
  for (const sha of before) {
    if (!shas.includes(sha)) {
      awaitName(db, sha, now);
    }
  }
};

// a purged item: the files it and its change sets named are asked about at the alarm's next run,
// which an import may put off
export const dropItemBlobs = (storage: CellStorage, itemId: string, now: number): void => {
  const { db } = storage;
  const shas = deleteItemBlobs(db, itemId);
  const kept = storage
    .all("DELETE FROM change_set_blobs WHERE item_id = ? RETURNING sha256", [itemId])
    .map((row) => shaRowSchema.parse(row).sha256);
  recountRefs(db, shas);
  for (const sha of new Set([...shas, ...kept])) {
    awaitNameAgain(db, sha, now);
  }
};

export const readBlobRow = (db: CellDb, sha: string) =>
  db
    .select({ bytes: blobs.bytes, mime: blobs.mime })
    .from(blobs)
    .where(eq(blobs.sha256, sha))
    .get() ?? null;

// ---- uploads ----

// how long room is held for an upload that has not landed
const UPLOAD_HOLD_MS = 60 * 60_000;

const uploadJobId = (sha: string): string => `upload:${sha}`;

const heldUpload = (db: CellDb, sha: string) =>
  db
    .select({ bytes: blobUploads.bytes, mime: blobUploads.mime })
    .from(blobUploads)
    .where(eq(blobUploads.sha256, sha))
    .get() ?? null;

export interface UploadRequest {
  readonly sha: string;
  readonly bytes: number;
  readonly mime: string;
}

// `held` when the library has the file already, so the device skips the upload
export interface UploadRoom {
  readonly held: boolean;
}

// room for a file a device is about to upload
export const reserveUpload = (
  storage: CellStorage,
  bytesCap: number,
  request: UploadRequest,
  now: number,
): UploadRoom => {
  const { db } = storage;
  if (heldShas(db, [request.sha]).size > 0) {
    return { held: true };
  }
  const prior = heldUpload(db, request.sha);
  const growth = request.bytes - (prior?.bytes ?? 0);
  holdRoomFor(storage, bytesCap, growth);
  db.insert(blobUploads)
    .values({ bytes: request.bytes, mime: request.mime, sha256: request.sha })
    .onConflictDoUpdate({
      set: { bytes: excluded(blobUploads.bytes), mime: excluded(blobUploads.mime) },
      target: blobUploads.sha256,
    })
    .run();
  addFileBytes(db, growth);
  scheduleJob(
    db,
    { id: uploadJobId(request.sha), kind: "upload", payload: JSON.stringify({ sha: request.sha }) },
    now + UPLOAD_HOLD_MS,
  );
  return { held: false };
};

const releaseHeld = (db: CellDb, sha: string, bytes: number): void => {
  db.delete(blobUploads).where(eq(blobUploads.sha256, sha)).run();
  addFileBytes(db, -bytes);
  dropJob(db, uploadJobId(sha));
};

// ---- strays ----

// A stray is what R2 may hold under a sha no file row names: an upload the cell refused, or one
// whose room was let go before it settled. Its removal is a job the alarm runs between two
// transactions, since it waits on R2. While the job waits a settle of that sha lands nothing, and
// a settle whose look in R2 began before a removal ended lands nothing either, by the count of
// removals it read first, so no file row ever names an object a removal took.

const BLOB_REMOVALS = "blob_removals";

const strayJobId = (sha: string): string => `stray:${sha}`;

const strayJob = (sha: string) =>
  ({ id: strayJobId(sha), kind: "stray", payload: JSON.stringify({ sha }) }) as const;

// the removals the cell has finished, which a settle reads before it looks in R2
export const blobRemovals = (db: CellDb): number => readCount(db, BLOB_REMOVALS);

const strayPending = (db: CellDb, sha: string): boolean =>
  db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.id, strayJobId(sha)))
    .get() !== undefined;

const strand = (db: CellDb, sha: string, now: number): void => {
  if (heldShas(db, [sha]).size === 0) {
    ensureJob(db, strayJob(sha), now);
  }
};

// room nobody used: the upload never settled, and whatever it put in R2 goes
export const releaseUpload = (db: CellDb, sha: string, now: number): void => {
  const held = heldUpload(db, sha);
  if (held !== null) {
    releaseHeld(db, sha, held.bytes);
    strand(db, sha, now);
  }
};

// an upload the cell would not take: its room goes, and so do its bytes in R2
export const refuseUpload = (db: CellDb, sha: string, now: number): void => {
  const held = heldUpload(db, sha);
  if (held !== null) {
    releaseHeld(db, sha, held.bytes);
  }
  strand(db, sha, now);
};

// a file nothing names, let go: its row leaves the library, its bytes leave the quota, and what R2
// holds of it is a stray the alarm takes out; a file an item or any change set names stays
export const releaseUnnamed = (db: CellDb, shas: readonly string[], now: number): void => {
  for (const sha of new Set(shas)) {
    const row = db
      .select({ bytes: blobs.bytes, refs: blobs.refs })
      .from(blobs)
      .where(
        and(
          eq(blobs.sha256, sha),
          exists(
            db
              .select({ id: jobs.id })
              .from(jobs)
              .where(eq(jobs.id, unnamedJobId(sha))),
          ),
          sql`NOT EXISTS (SELECT 1 FROM change_set_blobs WHERE sha256 = ${sha})`,
        ),
      )
      .get();
    dropJob(db, unnamedJobId(sha));
    if (row?.refs === 0) {
      db.delete(blobs).where(eq(blobs.sha256, sha)).run();
      addFileBytes(db, -row.bytes);
      ensureJob(db, strayJob(sha), now);
    }
  }
};

// a stray's removal may begin; false, with its job dropped, once a file row or a fresh upload's
// room holds the sha, since that upload's own settle or release decides what stays
export const beginRemoval = (db: CellDb, sha: string): boolean => {
  if (heldShas(db, [sha]).size > 0 || heldUpload(db, sha) !== null) {
    dropJob(db, strayJobId(sha));
    return false;
  }
  return true;
};

// R2 holds nothing under the sha now
export const endRemoval = (db: CellDb, sha: string): void => {
  writeMeta(db, BLOB_REMOVALS, blobRemovals(db) + 1);
  dropJob(db, strayJobId(sha));
};

// what R2 holds under the file's key, read before the transaction: null when nothing landed
export interface StoredObject {
  readonly bytes: number;
  readonly mime: string;
}

// the file's row lands at the size R2 holds; an upload whose room was let go meanwhile is taken
// in again if it still fits. `removalsSeen` is `blobRemovals` as it stood before R2 was read: a
// stray's removal waiting, or one ended since, may have taken what R2 showed, so the device
// uploads again into the room it holds. False when no file row holds the sha
export const settleUpload = (
  storage: CellStorage,
  bytesCap: number,
  upload: {
    readonly sha: string;
    readonly stored: StoredObject | null;
    readonly removalsSeen: number;
  },
  now: number,
): boolean => {
  const { db } = storage;
  const { removalsSeen, sha, stored } = upload;
  if (heldShas(db, [sha]).size > 0) {
    return true;
  }
  if (strayPending(db, sha) || blobRemovals(db) !== removalsSeen) {
    return false;
  }
  const held = heldUpload(db, sha);
  if (stored === null) {
    if (held !== null) {
      releaseHeld(db, sha, held.bytes);
    }
    return false;
  }
  const reserved = held?.bytes ?? 0;
  holdRoomFor(storage, bytesCap, stored.bytes - reserved);
  if (held !== null) {
    releaseHeld(db, sha, reserved);
  }
  db.insert(blobs)
    .values({ bytes: stored.bytes, mime: held?.mime ?? stored.mime, refs: 0, sha256: sha })
    .run();
  addFileBytes(db, stored.bytes);
  awaitName(db, sha, now);
  return true;
};
