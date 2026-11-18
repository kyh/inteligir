// Bytes the cloud holds itself, a page's cover or a file the fill read, kept as a device's upload
// is: put at a fresh pathname that expires in a day, then landed by the same write as a settle,
// without reading them back, since they were hashed here.

import { createHash, randomUUID } from "node:crypto";

import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import { db } from "@repo/db/drizzle-client";

import type { LibraryResult } from "../library/library-refusal";
import type { LibraryWriter } from "../library/library-store";
import { accountFilesPrefix, landKeptFile, mediaTypeOf } from "./file-landing";
import { touchFile } from "./file-names";
import { FILE_STORE } from "./file-store-of";

// the sha the bytes are kept under, whether this kept them or the library held them already
export const keepFile = async (
  writer: LibraryWriter,
  bytes: Uint8Array,
  mime: string,
): Promise<LibraryResult<string>> => {
  if (bytes.byteLength > BLOB_MAX_BYTES) {
    return { ok: false, refusal: { kind: "blob-too-large" } };
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  if ((await touchFile(db, writer.accountId, sha, Date.now())) !== null) {
    return { ok: true, value: sha };
  }
  const pathname = `${accountFilesPrefix(writer.accountId)}${sha}/${randomUUID()}`;
  const type = mediaTypeOf(mime);
  await FILE_STORE.put(pathname, bytes, type);
  const landed = await landKeptFile(writer, {
    bytes: bytes.byteLength,
    mime: type,
    pathname,
    sha,
  });
  return landed.ok ? { ok: true, value: sha } : landed;
};
