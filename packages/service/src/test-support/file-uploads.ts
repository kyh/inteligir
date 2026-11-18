// A file's bytes as a device sends and reads them, for the files' suites: the cloud reached through
// the handlers apps/web mounts, `/v1/rpc` and `/v1/blobs/<sha>` under a door's headers, and the
// folder store's upload route on the same origin, which takes no session.

import { createHash } from "node:crypto";

import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { uploadBlob } from "@repo/contract/rpc/call-outcome";
import type { V1Transport } from "@repo/contract/rpc/call-outcome";

import { DEV_FILES_PATH } from "../files/dev-upload-signature";
import { devFilesRoute } from "../files/dev-files-route";
import { fileReadRoute } from "../files/file-read-route";
import { handleV1Rpc } from "../rpc/v1-rpc";
import { ORIGIN } from "./auth-requests";

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const fileOf = (text: string) => {
  const bytes = Uint8Array.from(new TextEncoder().encode(text));
  return { bytes, sha: sha256Hex(bytes) };
};

export const blobUrlOf = (sha: string): string => `${ORIGIN}${V1_BLOBS_PATH}/${sha}`;

const signed = (request: Request, headers: Record<string, string>): Request => {
  const merged = new Headers(request.headers);
  for (const [name, value] of Object.entries(headers)) {
    merged.set(name, value);
  }
  return new Request(request, { headers: merged });
};

const cloudTransport = (headers: Record<string, string>): V1Transport => ({
  fetch: async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === DEV_FILES_PATH) {
      return await devFilesRoute(request);
    }
    return pathname.startsWith(`${V1_BLOBS_PATH}/`)
      ? await fileReadRoute(signed(request, headers))
      : await handleV1Rpc(signed(request, headers));
  },
  origin: ORIGIN,
});

// a file uploaded as a device's own code sends one, which throws what the cloud refused it with
export const sendFile = async (
  headers: Record<string, string>,
  file: { readonly bytes: Uint8Array<ArrayBuffer>; readonly sha: string },
  mime = "image/png",
): Promise<void> => {
  await uploadBlob(cloudTransport(headers), { ...file, mime });
};

// the bytes of a PUT to an upload's URL, sent as the device sends them
export const putTo = async (
  url: string,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<Response> =>
  await devFilesRoute(
    new Request(new URL(url, ORIGIN), {
      body: bytes,
      headers: { "content-type": mime },
      method: "PUT",
    }),
  );
