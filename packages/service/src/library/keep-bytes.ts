// A file put in the library as every upload is, a device's, a page's cover the fill kept and an
// import's: room asked of the account's cell at its length, the bytes put in R2 under their
// SHA-256, which R2 checks, and the row settled at the size R2 holds. A file the library already
// holds is not sent again, and a put that failed is settled too, so its room goes back unless R2
// kept the bytes after all. The cell is reached through a port: the Worker's stub of it, or the
// engine inside it.

import { z } from "zod";

import { blobKey } from "./cell-blobs";
import type { UploadRequest, UploadRoom } from "./cell-blobs";
import type { CellRefusal } from "./cell-refusal";
import type { LibraryDO } from "./library-do";
import type { UploadSettlement } from "./library-engine";

// a cell's answer as far as a keep reads it, which its stub's serialized answer is too
type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: Refusal };

type Refusal = Pick<CellRefusal, "kind">;

export interface KeepPort {
  readonly reserve: (request: UploadRequest) => Answer<UploadRoom> | Promise<Answer<UploadRoom>>;
  readonly settle: (sha: string) => Promise<Answer<UploadSettlement>>;
}

// the cell reached from the Worker, by its stub
export const stubPort = (cell: DurableObjectStub<LibraryDO>): KeepPort => ({
  reserve: async (request) => await cell.reserveBlob(request),
  settle: async (sha) => await cell.settleBlob(sha),
});

export type KeepOutcome =
  // the library held the file already, so nothing was sent
  | { readonly kind: "held" }
  | { readonly kind: "kept" }
  // the cell gave no room, or would not settle it
  | { readonly kind: "refused"; readonly refusal: Refusal }
  // R2 kept nothing: `badDigest` when the bytes did not hash to the sha, which a send again would
  // not change
  | { readonly kind: "unput"; readonly badDigest: boolean; readonly error: unknown }
  // a removal of these bytes raced the put, and the room still stands
  | { readonly kind: "raced" };

// R2's BadDigest (https://developers.cloudflare.com/r2/api/error-codes/), bytes that do not hash to
// the sha asked for; every other failure of a put says nothing of them. The runtime throws a plain
// Error whose message ends in R2's code, whatever `code` its types name
const badDigestSchema = z.object({ message: z.string().endsWith("(10037)") });

export const keepBytes = async (
  bucket: {
    readonly put: (
      key: string,
      value: ReadableStream | Uint8Array,
      options: R2PutOptions,
    ) => Promise<R2Object | null>;
  },
  port: KeepPort,
  file: {
    readonly accountId: string;
    readonly sha: string;
    readonly size: number;
    readonly mime: string;
    readonly body: () => Promise<ReadableStream | Uint8Array>;
  },
): Promise<KeepOutcome> => {
  const room = await port.reserve({ bytes: file.size, mime: file.mime, sha: file.sha });
  if (!room.ok) {
    return { kind: "refused", refusal: room.refusal };
  }
  if (room.value.held) {
    return { kind: "held" };
  }
  let unput: KeepOutcome | null = null;
  try {
    await bucket.put(blobKey(file.accountId, file.sha), await file.body(), {
      httpMetadata: { contentType: file.mime },
      sha256: file.sha,
    });
  } catch (error) {
    unput = { badDigest: badDigestSchema.safeParse(error).success, error, kind: "unput" };
  }
  const settled = await port.settle(file.sha);
  if (!settled.ok) {
    return unput ?? { kind: "refused", refusal: settled.refusal };
  }
  if (settled.value.settled) {
    return { kind: "kept" };
  }
  return unput ?? { kind: "raced" };
};
