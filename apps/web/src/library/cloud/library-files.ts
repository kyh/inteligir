// The library's files as this page reaches them: drawn from the cloud's own route under the session
// cookie, which the browser keeps as long as the cloud says a file under its sha never changes, and
// sent up there by their SHA-256 before anything names them.

import { V1_BLOBS_NAME_PARAM, V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { uploadBlob } from "@repo/contract/rpc/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";

// `/v1` for the bytes the wire does not carry, and the page's answer to a session's end met there,
// which the wire's own calls answer the same way (`./v1.ts`)
export interface FileCloud extends V1Transport {
  readonly onSessionEnd: (end: SessionEnd) => void;
}

// an item's original asks for the name it was saved under, which the browser's viewer titles it by
// and its download saves it as
export const fileUrl = (sha: string, name: string | null = null): string =>
  name === null
    ? `${V1_BLOBS_PATH}/${sha}`
    : `${V1_BLOBS_PATH}/${sha}?${new URLSearchParams({ [V1_BLOBS_NAME_PARAM]: name }).toString()}`;

// a file's bytes whole, as a Download saves one
export const readFile = async (cloud: V1Transport, sha: string): Promise<Blob> => {
  const response = await cloud.fetch(new Request(`${cloud.origin}${fileUrl(sha)}`));
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`the file answered ${String(response.status)}`);
  }
  return await response.blob();
};

// The sha `fileSha` spells, by the browser's own digest rather than the contract's pure JS: the
// browser hashes off the page's thread, so a file of up to 100 MB leaves the page answering
const shaOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

// the bytes in the library's files, answering the sha a block or an import names them by; a file
// the cloud refused throws as a refused call does
export const uploadFile = async (
  cloud: FileCloud,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<string> => {
  const sha = await shaOf(bytes);
  await uploadBlob(cloud, { bytes, mime, sha }, cloud.onSessionEnd);
  return sha;
};
