import { V1_BLOBS_NAME_PARAM, V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { uploadBlob } from "@repo/contract/rpc/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";

export interface FileCloud extends V1Transport {
  readonly onSessionEnd: (end: SessionEnd) => void;
}

export const fileUrl = (sha: string, name: string | null = null) =>
  name === null
    ? `${V1_BLOBS_PATH}/${sha}`
    : `${V1_BLOBS_PATH}/${sha}?${new URLSearchParams({ [V1_BLOBS_NAME_PARAM]: name }).toString()}`;

export const readFile = async (cloud: V1Transport, sha: string) => {
  const response = await cloud.fetch(new Request(`${cloud.origin}${fileUrl(sha)}`));

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`the file answered ${String(response.status)}`);
  }

  return await response.blob();
};

const shaOf = async (bytes: Uint8Array<ArrayBuffer>) => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const uploadFile = async (
  cloud: FileCloud,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
) => {
  const sha = await shaOf(bytes);
  await uploadBlob(cloud, { bytes, mime, sha }, cloud.onSessionEnd);

  return sha;
};
