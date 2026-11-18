// A file's bytes kept in the library under the sha they hash to, between two calls: `reserve` hands
// the device a store's URL for one object at a fresh pathname, `files/<accountId>/<sha>/<nonce>`,
// which expires in a day, and `settle` hashes what arrived and keeps it, clearing its expiry in the
// write that inserts its row. A file the library holds already is `held` and never sent twice; an
// upload refused or abandoned is let go, or goes by itself.

import { createHash, randomUUID } from "node:crypto";

import { UNKNOWN_FILE_TYPE } from "@repo/contract/items/item-kind";
import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import { db } from "@repo/db/drizzle-client";
import { file } from "@repo/db/library-schema";
import { z } from "zod";

import { holdRoomFor, roomRefusalFor } from "../library/library-quota";
import type { LibraryResult } from "../library/library-refusal";
import { writeLibrary } from "../library/library-store";
import type { LibraryWriter } from "../library/library-store";
import { fileOf } from "./file-names";
import { FILE_STORE } from "./file-store-of";
import type { UploadTicket } from "./file-store";
import { openUpload, sealUpload } from "./upload-seal";

// how long a device has to send what it reserved: Blob checks the deadline when an upload ends, not
// when it starts, so a large file on a slow link needs the hour (sp-presigned-put)
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

export const accountFilesPrefix = (accountId: string): string => `files/${accountId}/`;

const filePathname = (accountId: string, sha: string, nonce: string): string =>
  `${accountFilesPrefix(accountId)}${sha}/${nonce}`;

const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

// the type a file was sent as, without its parameters, or bytes of no known type
export const mediaTypeOf = (header: string): string => {
  const type = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return MEDIA_TYPE.test(type) ? type : UNKNOWN_FILE_TYPE;
};

export type Reserved =
  | { readonly kind: "held" }
  | ({ readonly kind: "upload"; readonly uploadId: string } & UploadTicket);

// where a device sends a file of `bytes` as `mime`, or `held` when the library holds it; the room
// it asks is a guess the settle's own write settles
export const reserveFile = async (
  { accountId }: LibraryWriter,
  ask: { readonly sha: string; readonly bytes: number; readonly mime: string },
): Promise<LibraryResult<Reserved>> => {
  const { bytes, sha } = ask;
  if (bytes > BLOB_MAX_BYTES) {
    return { ok: false, refusal: { kind: "blob-too-large" } };
  }
  if ((await fileOf(db, accountId, sha)) !== null) {
    return { ok: true, value: { kind: "held" } };
  }
  const full = await roomRefusalFor(db, accountId, bytes);
  if (full !== null) {
    return { ok: false, refusal: full };
  }
  const mime = mediaTypeOf(ask.mime);
  const nonce = randomUUID();
  const ticket = await FILE_STORE.uploadTicket({
    bytes,
    mime,
    pathname: filePathname(accountId, sha, nonce),
    validUntil: Date.now() + UPLOAD_WINDOW_MS,
  });
  return {
    ok: true,
    value: { ...ticket, kind: "upload", uploadId: sealUpload({ bytes, mime, nonce, sha }) },
  };
};

const settledSchema = z.object({ kind: z.enum(["held", "kept"]) });

export type Settled = z.infer<typeof settledSchema>;

// an object kept for its sha: the size the store holds, and the type its upload named
interface KeptObject {
  readonly sha: string;
  readonly pathname: string;
  readonly bytes: number;
  readonly mime: string;
}

// The row for an object whose bytes are known to hash to its sha, in one write under the account's
// lock, the store's keep inside it, so no row names an object that can still expire. A sha the
// library came to hold meanwhile is `held`, and the object, a copy, goes; one refused goes too. A
// busy lock leaves the object for the device to settle again
export const landKeptFile = async (
  writer: LibraryWriter,
  kept: KeptObject,
): Promise<LibraryResult<Settled>> => {
  const { bytes, mime, pathname, sha } = kept;
  const landed = await writeLibrary(
    writer,
    { answer: settledSchema, opId: undefined },
    async (scope): Promise<Settled> => {
      const held = await fileOf(scope.tx, scope.accountId, sha);
      if (held !== null) {
        return { kind: held.pathname === pathname ? "kept" : "held" };
      }
      await holdRoomFor(scope, bytes);
      await FILE_STORE.keep(pathname);
      await scope.tx.insert(file).values({
        accountId: scope.accountId,
        bytes,
        createdAt: scope.now,
        mime,
        pathname,
        sha256: sha,
        touchedAt: scope.now,
      });
      return { kind: "kept" };
    },
  );
  const copy = landed.ok ? landed.value.kind === "held" : landed.refusal.kind !== "busy";
  if (copy) {
    await FILE_STORE.remove(pathname);
  }
  return landed;
};

const sha256Of = async (body: ReadableStream<Uint8Array>): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of body) {
    hash.update(chunk);
  }
  return hash.digest("hex");
};

// the upload `reserveFile` named, kept once its object is the size it named and hashes to its sha;
// sent again after it landed, it finds its own row
export const settleFile = async (
  writer: LibraryWriter,
  { sha, uploadId }: { readonly sha: string; readonly uploadId: string },
): Promise<LibraryResult<Settled>> => {
  const seal = openUpload(uploadId);
  if (seal === null || seal.sha !== sha) {
    return { ok: false, refusal: { kind: "not-found" } };
  }
  const pathname = filePathname(writer.accountId, sha, seal.nonce);
  const held = await fileOf(db, writer.accountId, sha);
  if (held !== null) {
    if (held.pathname !== pathname) {
      await FILE_STORE.remove(pathname);
    }
    return { ok: true, value: { kind: held.pathname === pathname ? "kept" : "held" } };
  }
  const object = await FILE_STORE.head(pathname);
  if (object === null) {
    return { ok: false, refusal: { kind: "not-found" } };
  }
  if (object.bytes !== seal.bytes) {
    await FILE_STORE.remove(pathname);
    return {
      ok: false,
      refusal: { kind: object.bytes > seal.bytes ? "blob-too-large" : "blob-mismatch" },
    };
  }
  const read = await FILE_STORE.read(pathname, null);
  if (read === null) {
    return { ok: false, refusal: { kind: "not-found" } };
  }
  if ((await sha256Of(read.body)) !== sha) {
    await FILE_STORE.remove(pathname);
    return { ok: false, refusal: { kind: "blob-mismatch" } };
  }
  return await landKeptFile(writer, { bytes: object.bytes, mime: seal.mime, pathname, sha });
};
