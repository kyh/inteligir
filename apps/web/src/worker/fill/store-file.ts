// A file the cloud kept from a page (its cover, or the picture or PDF a link answered with), put in
// the library as a device's upload is (`../library/blob-routes`): room asked of the account's cell
// at its length, the bytes put in R2 under their SHA-256, which R2 checks, and the row settled at
// the size R2 holds. A file the library already holds is not sent again.

import { blobKey } from "../library/cell-blobs";
import type { LibraryDO } from "../library/library-do";
import { errorFields } from "../log";

const hex = (digest: ArrayBuffer): string =>
  [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

// the file's sha once the library holds it, or null when the cell refused it (the library is full,
// the account went) or R2 did not keep it
export const storeFile = async (
  bucket: R2Bucket,
  cell: DurableObjectStub<LibraryDO>,
  accountId: string,
  file: { readonly bytes: Uint8Array; readonly mime: string },
): Promise<string | null> => {
  const sha = hex(await crypto.subtle.digest("SHA-256", file.bytes));
  const room = await cell.reserveBlob({ bytes: file.bytes.byteLength, mime: file.mime, sha });
  if (!room.ok) {
    return null;
  }
  if (room.value.held) {
    return sha;
  }
  try {
    await bucket.put(blobKey(accountId, sha), file.bytes, {
      httpMetadata: { contentType: file.mime },
      sha256: sha,
    });
  } catch (error) {
    console.warn({ event: "fill-file-refused", ...errorFields(error) });
  }
  const settled = await cell.settleBlob(sha);
  return settled.ok && settled.value.settled ? sha : null;
};
