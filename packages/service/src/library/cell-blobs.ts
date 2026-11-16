// The files an item holds, by the sha R2 keeps them under (`acct/<userId>/b/<sha>`): a write may
// name only a file the library already holds, and the file's row lands once the bytes do. A device
// asks for room before it uploads, the cell holds it against the quota, and once the upload is in
// R2 the cell reads its size there and lands the row; room held past an hour with no upload is let
// go by the alarm, and so is what such an upload, or one the cell refused, left in R2. A file stays
// while an item names it or any change set does (`change_set_blobs`), and once nothing does or
// will it is let go: at the alarm's next run after the reading that kept it lands nowhere or the
// last change set naming it went, and by the alarm a day after it landed or an item stopped naming
// it otherwise.

import { and, eq, exists, inArray, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import { blobs, blobUploads, changeSetBlobs, itemBlobs, jobs } from "@repo/db/cell/schema";
import { UNKNOWN_FILE_TYPE } from "@repo/contract/items/item-kind";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { readCellState, writeCellState } from "./library-queries";

import { excluded, insertChunks, listChunks } from "./cell-db";
import type { CellDb } from "./cell-db";
import { dropJob, ensureJob, retryJob, scheduleJob } from "./cell-jobs";
import type { DueJob, JobRequest } from "./cell-jobs";
import { holdRoomFor } from "./cell-quota";
import type { CellResult } from "./cell-refusal";
import type { LibraryEngine } from "./library-engine";

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

// ---- files change sets name ----

// what a fields part or a block version of the item names, kept with it
export const keepSetFiles = (
  db: CellDb,
  itemId: string,
  hash: string,
  shas: readonly string[],
): void => {
  const rows = [...new Set(shas)].map((sha256) => ({ hash, itemId, sha256 }));
  for (const chunk of insertChunks(changeSetBlobs, rows)) {
    db.insert(changeSetBlobs).values(chunk).onConflictDoNothing().run();
  }
};

// ---- files nothing names ----

// how long a file no item names waits for one, longer than any device's upload and its write
const UNNAMED_HOLD_MS = 24 * 60 * 60_000;

const unnamedJobId = (sha: string): string => `unnamed:${sha}`;

const unnamedJob = (sha: string): JobRequest<"unnamed"> => ({
  id: unnamedJobId(sha),
  kind: "unnamed",
  payload: { sha },
});

// a file just landed, or one an item just stopped naming, waits for an item to name it
const awaitName = (db: CellDb, sha: string, now: number): void => {
  scheduleJob(db, unnamedJob(sha), now + UNNAMED_HOLD_MS);
};

// a file whose last name went is asked about at the alarm's next run
const awaitNameAgain = (db: CellDb, sha: string, now: number): void => {
  scheduleJob(db, unnamedJob(sha), now);
};

// parts and block versions of the item no change set names any more: the alarm's next run asks
// about what they named
export const dropSetFiles = (
  db: CellDb,
  itemId: string,
  hashes: readonly string[],
  now: number,
): void => {
  const shas = listChunks(hashes, 1).flatMap((chunk) =>
    db
      .delete(changeSetBlobs)
      .where(and(eq(changeSetBlobs.itemId, itemId), inArray(changeSetBlobs.hash, chunk)))
      .returning({ sha256: changeSetBlobs.sha256 })
      .all(),
  );
  for (const sha of new Set(shas.map((row) => row.sha256))) {
    awaitNameAgain(db, sha, now);
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
  for (const sha of before) {
    if (!shas.includes(sha)) {
      awaitName(db, sha, now);
    }
  }
};

// a purged item: the files it and its change sets named are asked about at the alarm's next run
export const dropItemBlobs = (db: CellDb, itemId: string, now: number): void => {
  const shas = deleteItemBlobs(db, itemId);
  const kept = db
    .delete(changeSetBlobs)
    .where(eq(changeSetBlobs.itemId, itemId))
    .returning({ sha256: changeSetBlobs.sha256 })
    .all()
    .map((row) => row.sha256);
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

const reserveUpload = (
  db: CellDb,
  bytesCap: number,
  request: UploadRequest,
  now: number,
): UploadRoom => {
  if (heldShas(db, [request.sha]).size > 0) {
    return { held: true };
  }
  const prior = heldUpload(db, request.sha);
  const growth = request.bytes - (prior?.bytes ?? 0);
  holdRoomFor(db, bytesCap, growth);
  db.insert(blobUploads)
    .values({ bytes: request.bytes, mime: request.mime, sha256: request.sha })
    .onConflictDoUpdate({
      set: { bytes: excluded(blobUploads.bytes), mime: excluded(blobUploads.mime) },
      target: blobUploads.sha256,
    })
    .run();
  scheduleJob(
    db,
    { id: uploadJobId(request.sha), kind: "upload", payload: { sha: request.sha } },
    now + UPLOAD_HOLD_MS,
  );
  return { held: false };
};

const releaseHeld = (db: CellDb, sha: string): void => {
  db.delete(blobUploads).where(eq(blobUploads.sha256, sha)).run();
  dropJob(db, uploadJobId(sha));
};

// ---- strays ----

// A stray is what R2 may hold under a sha no file row names: an upload the cell refused, or one
// whose room was let go before it settled. Its removal is a job the alarm runs between two
// transactions, since it waits on R2. While the job waits a settle of that sha lands nothing, and
// a settle whose look in R2 began before a removal ended lands nothing either, by the count of
// removals it read first, and looks again, so no file row ever names an object a removal took.

const strayJobId = (sha: string): string => `stray:${sha}`;

const strayJob = (sha: string): JobRequest<"stray"> => ({
  id: strayJobId(sha),
  kind: "stray",
  payload: { sha },
});

// the removals the cell has finished, which a settle reads before it looks in R2
export const blobRemovals = (db: CellDb): number => readCellState(db)?.blobRemovals ?? 0;

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
  if (heldUpload(db, sha) !== null) {
    releaseHeld(db, sha);
    strand(db, sha, now);
  }
};

// an upload the cell would not take: its room goes, and so do its bytes in R2
const refuseUpload = (db: CellDb, sha: string, now: number): void => {
  releaseHeld(db, sha);
  strand(db, sha, now);
};

// a file nothing names, let go: its row leaves the library, its bytes leave the quota, and what R2
// holds of it is a stray the alarm takes out; a file an item or any change set names stays
export const releaseUnnamed = (db: CellDb, shas: readonly string[], now: number): void => {
  for (const sha of new Set(shas)) {
    const [unnamed] = db
      .delete(blobs)
      .where(
        and(
          eq(blobs.sha256, sha),
          exists(
            db
              .select({ id: jobs.id })
              .from(jobs)
              .where(eq(jobs.id, unnamedJobId(sha))),
          ),
          notExists(
            db
              .select({ sha256: itemBlobs.sha256 })
              .from(itemBlobs)
              .where(eq(itemBlobs.sha256, sha)),
          ),
          notExists(
            db
              .select({ sha256: changeSetBlobs.sha256 })
              .from(changeSetBlobs)
              .where(eq(changeSetBlobs.sha256, sha)),
          ),
        ),
      )
      .returning({ sha256: blobs.sha256 })
      .all();
    dropJob(db, unnamedJobId(sha));
    if (unnamed !== undefined) {
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
  writeCellState(db, { blobRemovals: blobRemovals(db) + 1 });
  dropJob(db, strayJobId(sha));
};

// R2 failed the removal, which waits its turn again, unless an upload's room took the sha while it
// ran: that upload's settle or release decides what stays, as when a removal is about to begin, and
// what a settle read of R2 meanwhile it reads again, since a removal that failed may have removed
export const failRemoval = (db: CellDb, job: DueJob<"stray">, now: number): void => {
  if (heldUpload(db, job.payload.sha) === null) {
    retryJob(db, job, now);
  } else {
    endRemoval(db, job.payload.sha);
  }
};

// what R2 holds under the file's key, read before the transaction: null when nothing landed
export interface StoredObject {
  readonly bytes: number;
  readonly mime: string;
}

// What a settle found. `held`: a file row holds the sha. Nothing landed otherwise: `absent`, R2
// held nothing, so the upload's room went back; `removing`, a stray's removal of the sha waits;
// `stale`, a removal ended after R2 was read, so what R2 showed may be gone and a fresh look says
const SETTLEMENTS = ["held", "absent", "removing", "stale"] as const;
export type Settlement = (typeof SETTLEMENTS)[number];

// the file's row lands at the size R2 holds; an upload whose room was let go meanwhile is taken
// in again if it still fits. `removalsSeen` is `blobRemovals` as it stood before R2 was read
const settleUpload = (
  db: CellDb,
  bytesCap: number,
  upload: {
    readonly sha: string;
    readonly stored: StoredObject | null;
    readonly removalsSeen: number;
  },
  now: number,
): Settlement => {
  const { removalsSeen, sha, stored } = upload;
  if (heldShas(db, [sha]).size > 0) {
    return "held";
  }
  if (strayPending(db, sha)) {
    return "removing";
  }
  if (blobRemovals(db) !== removalsSeen) {
    return "stale";
  }
  const held = heldUpload(db, sha);
  if (stored === null) {
    releaseHeld(db, sha);
    return "absent";
  }
  holdRoomFor(db, bytesCap, stored.bytes - (held?.bytes ?? 0));
  releaseHeld(db, sha);
  db.insert(blobs)
    .values({ bytes: stored.bytes, mime: held?.mime ?? stored.mime, sha256: sha })
    .run();
  awaitName(db, sha, now);
  return "held";
};

// ---- an upload, through the engine ----

const roomSchema = z.object({ held: z.boolean() });

// room for a file a device is about to upload
export const reserve = (library: LibraryEngine, request: UploadRequest): CellResult<UploadRoom> =>
  library.landApart({ answer: roomSchema, opId: undefined }, (scope) =>
    reserveUpload(scope.db, scope.bytesCap, request, scope.now),
  );

// the file's row once R2 holds it, at the size R2 reports, R2 read after `removalsSeen` was;
// bytes past the quota go from R2 again
export const settle = (
  library: LibraryEngine,
  sha: string,
  stored: StoredObject | null,
  removalsSeen: number,
): CellResult<Settlement> => {
  const settled = library.landApart({ answer: z.enum(SETTLEMENTS), opId: undefined }, (scope) =>
    settleUpload(scope.db, scope.bytesCap, { removalsSeen, sha, stored }, scope.now),
  );
  if (!settled.ok && settled.refusal.kind === "quota") {
    library.rows((db, now) => {
      refuseUpload(db, sha, now);
    });
  }
  return settled;
};

// a file's row once its upload is in R2, at the size R2 holds; the transaction reads the upload's
// record after this await, so nothing read before it is trusted but the count of stray removals,
// which tells it whether one ran meanwhile. One that did is most often another file's, so R2 is
// read once more before the device is asked to send again. Every writer settles here, a device's
// upload and a page's file the fill kept, so this is where bytes that took their room before the
// account's tombstone and reached R2 after its files went are taken out again: nothing under a
// deleted account's prefix stays (`./account-purge`)
export const settleStored = async (
  env: Env,
  accountId: string,
  library: LibraryEngine,
  sha: string,
): Promise<CellResult<Settlement>> => {
  const key = blobKey(accountId, sha);
  const look = async (): Promise<CellResult<Settlement>> => {
    const removalsSeen = library.read(blobRemovals);
    if (!removalsSeen.ok) {
      return removalsSeen;
    }
    const object = await env.BLOBS.head(key);
    const stored =
      object === null
        ? null
        : { bytes: object.size, mime: object.httpMetadata?.contentType ?? UNKNOWN_FILE_TYPE };
    return settle(library, sha, stored, removalsSeen.value);
  };
  let settled = await look();
  if (settled.ok && settled.value === "stale") {
    settled = await look();
  }
  if (!settled.ok && settled.refusal.kind === "gone") {
    await env.BLOBS.delete(key);
  }
  return settled;
};
