// The files an item holds, by the sha R2 keeps them under (`acct/<userId>/b/<sha>`): a write may
// name only a file the library already holds, and the file's row lands once the bytes do. A device
// asks for room before it uploads, the cell holds it against the quota, and once the upload is in
// R2 the cell reads its size there and lands the row; room held past an hour with no upload is let
// go by the alarm.

import type { ItemState } from "@repo/notes/library/block-ops";
import type { BlobRole } from "@repo/notes/library/library-schema";
import type { LibraryNode } from "@repo/notes/library/library-nodes";
import { chunkStatement } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { dropJob, scheduleJob } from "./cell-jobs";
import { addFileBytes, holdRoomFor } from "./cell-quota";
import type { CellStorage } from "./cell-storage";

export const blobKey = (accountId: string, sha: string): string => `acct/${accountId}/b/${sha}`;

// everything R2 holds for one account, which its deletion empties
export const accountBlobPrefix = (accountId: string): string => `acct/${accountId}/`;

export interface BlobRef {
  readonly sha: string;
  readonly role: BlobRole;
}

const shasIn = (node: LibraryNode, into: Set<string>): void => {
  if (!("children" in node)) {
    return;
  }
  if ("sha" in node && node.sha !== undefined) {
    into.add(node.sha);
  }
  for (const child of node.children) {
    shasIn(child, into);
  }
};

// every file an item names: its original, cover and page copy by field, and each image, video or
// file its body embeds
export const blobRefsOf = (state: ItemState): BlobRef[] => {
  const refs: BlobRef[] = [];
  const { copySha, coverSha, originalSha } = state.fields;
  if (originalSha !== null) {
    refs.push({ role: "original", sha: originalSha });
  }
  if (coverSha !== null) {
    refs.push({ role: "cover", sha: coverSha });
  }
  if (copySha !== null) {
    refs.push({ role: "copy", sha: copySha });
  }
  const embedded = new Set<string>();
  for (const stored of state.blocks.values()) {
    shasIn(stored.block, embedded);
  }
  for (const sha of embedded) {
    refs.push({ role: "embed", sha });
  }
  return refs;
};

const shaRowSchema = z.object({ sha256: z.string() });

const heldShas = (sql: SqlStatements, shas: readonly string[]): Set<string> => {
  const held = new Set<string>();
  for (const statement of chunkStatement({
    each: "?",
    head: "SELECT sha256 FROM blobs WHERE sha256 IN (",
    rows: shas.map((sha) => [sha]),
    separator: ", ",
    tail: ")",
  })) {
    for (const row of sql.all(statement.sql, statement.params)) {
      held.add(shaRowSchema.parse(row).sha256);
    }
  }
  return held;
};

// of `shas`, those the library holds no file for
export const missingBlobs = (sql: SqlStatements, shas: readonly string[]): string[] => {
  const unique = [...new Set(shas)];
  const held = heldShas(sql, unique);
  return unique.filter((sha) => !held.has(sha)).toSorted();
};

// how many items name each file, recounted for the files a write touched
const recountRefs = (sql: SqlStatements, shas: readonly string[]): void => {
  for (const statement of chunkStatement({
    each: "?",
    head: `UPDATE blobs SET refs = (SELECT count(*) FROM item_blobs
      WHERE item_blobs.sha256 = blobs.sha256) WHERE sha256 IN (`,
    rows: [...new Set(shas)].map((sha) => [sha]),
    separator: ", ",
    tail: ")",
  })) {
    sql.run(statement.sql, statement.params);
  }
};

export const itemBlobShas = (sql: SqlStatements, itemId: string): string[] =>
  sql
    .all("SELECT sha256 FROM item_blobs WHERE item_id = ?", [itemId])
    .map((row) => shaRowSchema.parse(row).sha256);

export const storeItemBlobs = (
  sql: SqlStatements,
  itemId: string,
  refs: readonly BlobRef[],
): void => {
  const before = itemBlobShas(sql, itemId);
  sql.run("DELETE FROM item_blobs WHERE item_id = ?", [itemId]);
  for (const statement of chunkStatement({
    each: "(?, ?, ?)",
    head: "INSERT INTO item_blobs (item_id, sha256, role) VALUES ",
    rows: refs.map((ref) => [itemId, ref.sha, ref.role]),
    separator: ", ",
    tail: " ON CONFLICT DO NOTHING",
  })) {
    sql.run(statement.sql, statement.params);
  }
  recountRefs(sql, [...before, ...refs.map((ref) => ref.sha)]);
};

export const dropItemBlobs = (
  sql: SqlStatements,
  itemId: string,
  shas: readonly string[],
): void => {
  sql.run("DELETE FROM item_blobs WHERE item_id = ?", [itemId]);
  recountRefs(sql, shas);
};

const blobRowSchema = z.object({
  bytes: z.number().int().nonnegative(),
  h: z.number().int().positive().nullable(),
  mime: z.string(),
  sha256: z.string(),
  w: z.number().int().positive().nullable(),
});

// a pulled file row, as the wire names its fields
export const readBlobRow = (sql: SqlStatements, sha: string) => {
  const [raw] = sql.all("SELECT sha256, bytes, mime, w, h FROM blobs WHERE sha256 = ?", [sha]);
  if (raw === undefined) {
    return null;
  }
  const row = blobRowSchema.parse(raw);
  return { bytes: row.bytes, h: row.h, mime: row.mime, sha: row.sha256, w: row.w };
};

// ---- uploads ----

// how long room is held for an upload that has not landed
const UPLOAD_HOLD_MS = 60 * 60_000;

const uploadRowSchema = z.object({ bytes: z.number().int().nonnegative(), mime: z.string() });

const uploadJobId = (sha: string): string => `upload:${sha}`;

const heldUpload = (sql: SqlStatements, sha: string) => {
  const [row] = sql.all("SELECT bytes, mime FROM blob_uploads WHERE sha256 = ?", [sha]);
  return row === undefined ? null : uploadRowSchema.parse(row);
};

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
  if (heldShas(storage, [request.sha]).size > 0) {
    return { held: true };
  }
  const prior = heldUpload(storage, request.sha);
  const growth = request.bytes - (prior?.bytes ?? 0);
  holdRoomFor(storage, bytesCap, growth);
  storage.run(
    `INSERT INTO blob_uploads (sha256, bytes, mime, reserved_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (sha256) DO UPDATE SET bytes = excluded.bytes, mime = excluded.mime,
       reserved_at = excluded.reserved_at`,
    [request.sha, request.bytes, request.mime, now],
  );
  addFileBytes(storage, growth);
  scheduleJob(
    storage,
    { id: uploadJobId(request.sha), kind: "upload", payload: JSON.stringify({ sha: request.sha }) },
    now + UPLOAD_HOLD_MS,
  );
  return { held: false };
};

const releaseHeld = (storage: CellStorage, sha: string, bytes: number): void => {
  storage.run("DELETE FROM blob_uploads WHERE sha256 = ?", [sha]);
  addFileBytes(storage, -bytes);
  dropJob(storage, uploadJobId(sha));
};

// room nobody used: the upload never landed
export const releaseUpload = (storage: CellStorage, sha: string): void => {
  const held = heldUpload(storage, sha);
  if (held !== null) {
    releaseHeld(storage, sha, held.bytes);
  }
};

// what R2 holds under the file's key, read before the transaction: null when nothing landed
export interface StoredObject {
  readonly bytes: number;
  readonly mime: string;
}

// `landed` when the file's row is new, which moves the library's head
export interface UploadSettled {
  readonly settled: boolean;
  readonly landed: boolean;
}

// the file's row lands at the size R2 holds; an upload whose room was let go meanwhile is taken
// in again if it still fits
export const settleUpload = (
  storage: CellStorage,
  bytesCap: number,
  sha: string,
  stored: StoredObject | null,
): UploadSettled => {
  if (heldShas(storage, [sha]).size > 0) {
    return { landed: false, settled: true };
  }
  const held = heldUpload(storage, sha);
  if (stored === null) {
    if (held !== null) {
      releaseHeld(storage, sha, held.bytes);
    }
    return { landed: false, settled: false };
  }
  const reserved = held?.bytes ?? 0;
  holdRoomFor(storage, bytesCap, stored.bytes - reserved);
  if (held !== null) {
    releaseHeld(storage, sha, reserved);
  }
  storage.run(
    "INSERT INTO blobs (sha256, bytes, mime, w, h, refs) VALUES (?, ?, ?, NULL, NULL, 0)",
    [sha, stored.bytes, held?.mime ?? stored.mime],
  );
  addFileBytes(storage, stored.bytes);
  return { landed: true, settled: true };
};
