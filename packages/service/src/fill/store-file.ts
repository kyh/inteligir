// A file the cloud kept from a page (its cover, or the picture or PDF a link answered with), put in
// the library as a device's upload is (`../library/keep-bytes`), named by its SHA-256.

import { bytesToHex } from "@noble/hashes/utils.js";

import { keepBytes, stubPort } from "../library/keep-bytes";
import type { LibraryDO } from "../library/library-do";
import { errorFields } from "../log";

// the file's sha once the library holds it, or null when the cell refused it (the library is full,
// the account went) or R2 did not keep it
export const storeFile = async (
  bucket: R2Bucket,
  cell: DurableObjectStub<LibraryDO>,
  accountId: string,
  file: { readonly bytes: Uint8Array; readonly mime: string },
): Promise<string | null> => {
  const sha = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", file.bytes)));
  const kept = await keepBytes(bucket, stubPort(cell), {
    accountId,
    body: async () => await Promise.resolve(file.bytes),
    mime: file.mime,
    sha,
    size: file.bytes.byteLength,
  });
  if (kept.kind === "unput") {
    console.warn({ event: "fill-file-refused", ...errorFields(kept.error) });
  }
  return kept.kind === "held" || kept.kind === "kept" ? sha : null;
};
