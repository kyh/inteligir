// The library's files as this page reaches them: drawn from the cloud's own route under the session
// cookie, which the browser keeps as long as the cloud says a file under its sha never changes, and
// sent up there by their SHA-256 before anything names them.

import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { uploadBlob } from "@repo/contract/library/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/library/call-outcome";
import { fileSha } from "@repo/contract/library/file-sha";

// `/v1` for the bytes the wire does not carry, and the page's answer to a session's end met there,
// which the wire's own calls answer the same way (`./v1.ts`)
export interface FileCloud extends V1Transport {
  readonly onSessionEnd: (end: SessionEnd) => void;
}

export const fileUrl = (sha: string): string => `${V1_BLOBS_PATH}/${sha}`;

// a file's bytes whole, as the editor draws a picture in a note and a Download saves one
export const readFile = async (cloud: V1Transport, sha: string): Promise<Blob> => {
  const response = await cloud.fetch(new Request(`${cloud.origin}${fileUrl(sha)}`));
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`the file answered ${String(response.status)}`);
  }
  return await response.blob();
};

// the store's refusal of a file, in the person's words
export class FileRefusedError extends Error {
  override name = "FileRefusedError";
}

// the bytes in the library's files, answering the sha a block or an import names them by
export const uploadFile = async (
  cloud: FileCloud,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<string> => {
  const sha = fileSha(bytes);
  const outcome = await uploadBlob(cloud, { bytes, mime, sha });
  switch (outcome.kind) {
    case "stored": {
      return sha;
    }
    case "refused": {
      throw new FileRefusedError(outcome.reason);
    }
    case "failed": {
      if (outcome.failure.kind === "session") {
        cloud.onSessionEnd(outcome.failure.end);
      }
      throw new Error(`the file was not sent: ${outcome.failure.kind}`);
    }
    // no default
  }
};
