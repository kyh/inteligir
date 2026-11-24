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
import { touchFile } from "../library/file-names";
import { FILE_STORE } from "./file-store-of";
import type { UploadTicket } from "./file-store";
import { openUpload, sealUpload } from "./upload-seal";

const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

export const FILES_ROOT = "files/";

export const accountFilesPrefix = (accountId: string) => `${FILES_ROOT}${accountId}/`;

const filePathname = (accountId: string, sha: string, nonce: string) =>
  `${accountFilesPrefix(accountId)}${sha}/${nonce}`;

const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

export const mediaTypeOf = (header: string) => {
  const type = header.split(";")[0]?.trim().toLowerCase() ?? "";

  return MEDIA_TYPE.test(type) ? type : UNKNOWN_FILE_TYPE;
};

export type Reserved =
  | { readonly kind: "held" }
  | ({ readonly kind: "upload"; readonly uploadId: string } & UploadTicket);

export const reserveFile: (
  writer: LibraryWriter,
  ask: { readonly sha: string; readonly bytes: number; readonly mime: string },
) => Promise<LibraryResult<Reserved>> = async (
  { accountId }: LibraryWriter,
  ask: { readonly sha: string; readonly bytes: number; readonly mime: string },
) => {
  const { bytes, sha } = ask;

  if (bytes > BLOB_MAX_BYTES) {
    return { ok: false, refusal: { kind: "blob-too-large" } } satisfies LibraryResult<Reserved>;
  }

  if ((await touchFile(db, accountId, sha, Date.now())) !== null) {
    return { ok: true, value: { kind: "held" } } satisfies LibraryResult<Reserved>;
  }

  const full = await roomRefusalFor(db, accountId, bytes);

  if (full !== null) {
    return { ok: false, refusal: full } satisfies LibraryResult<Reserved>;
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
  } satisfies LibraryResult<Reserved>;
};

const settledSchema = z.object({ kind: z.enum(["held", "kept"]) });

type Settled = z.infer<typeof settledSchema>;

interface KeptObject {
  readonly sha: string;
  readonly pathname: string;
  readonly bytes: number;
  readonly mime: string;
}

export const landKeptFile = async (writer: LibraryWriter, kept: KeptObject) => {
  const { bytes, mime, pathname, sha } = kept;

  const landed = await writeLibrary(
    writer,
    { answer: settledSchema, opId: undefined },
    async (scope) => {
      const held = await touchFile(scope.tx, scope.accountId, sha, scope.now);

      if (held !== null) {
        return { kind: held.pathname === pathname ? "kept" : "held" } satisfies Settled;
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

      return { kind: "kept" } satisfies Settled;
    },
  );

  const copy = landed.ok ? landed.value.kind === "held" : landed.refusal.kind !== "busy";

  if (copy) {
    await FILE_STORE.remove(pathname);
  }

  return landed;
};

const sha256Of = async (body: ReadableStream<Uint8Array>) => {
  const hash = createHash("sha256");

  for await (const chunk of body) {
    hash.update(chunk);
  }

  return hash.digest("hex");
};

export const settleFile = async (
  writer: LibraryWriter,
  { sha, uploadId }: { readonly sha: string; readonly uploadId: string },
) => {
  const seal = openUpload(uploadId);

  if (seal === null || seal.sha !== sha) {
    return { ok: false, refusal: { kind: "not-found" } } satisfies LibraryResult<Settled>;
  }

  const pathname = filePathname(writer.accountId, sha, seal.nonce);
  const held = await touchFile(db, writer.accountId, sha, Date.now());

  if (held !== null) {
    if (held.pathname !== pathname) {
      await FILE_STORE.remove(pathname);
    }

    return {
      ok: true,
      value: { kind: held.pathname === pathname ? "kept" : "held" },
    } satisfies LibraryResult<Settled>;
  }

  const object = await FILE_STORE.head(pathname);

  if (object === null) {
    return { ok: false, refusal: { kind: "not-found" } } satisfies LibraryResult<Settled>;
  }

  if (object.bytes !== seal.bytes) {
    await FILE_STORE.remove(pathname);

    return {
      ok: false,
      refusal: { kind: object.bytes > seal.bytes ? "blob-too-large" : "blob-mismatch" },
    } satisfies LibraryResult<Settled>;
  }

  const read = await FILE_STORE.read(pathname, null);

  if (read === null) {
    return { ok: false, refusal: { kind: "not-found" } } satisfies LibraryResult<Settled>;
  }

  if ((await sha256Of(read.body)) !== sha) {
    await FILE_STORE.remove(pathname);

    return { ok: false, refusal: { kind: "blob-mismatch" } } satisfies LibraryResult<Settled>;
  }

  return await landKeptFile(writer, { bytes: object.bytes, mime: seal.mime, pathname, sha });
};
