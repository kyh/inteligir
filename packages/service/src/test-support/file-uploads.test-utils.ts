import { createHash } from "node:crypto";

import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { uploadBlob } from "@repo/contract/rpc/call-outcome";
import type { V1Transport } from "@repo/contract/rpc/call-outcome";

import { DEV_FILES_PATH } from "../files/dev-upload-signature";
import { devFilesRoute } from "../files/dev-files-route";
import { fileReadRoute } from "../rpc/file-read-route";
import { handleV1Rpc } from "../rpc/v1-rpc";
import { ORIGIN } from "./auth-requests.test-utils";

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export const fileOf = (text: string) => {
  const bytes = Uint8Array.from(new TextEncoder().encode(text));

  return { bytes, sha: sha256Hex(bytes) };
};

export const blobUrlOf = (sha: string) => `${ORIGIN}${V1_BLOBS_PATH}/${sha}`;

const signed = (request: Request, headers: Record<string, string>) => {
  const merged = new Headers(request.headers);

  for (const [name, value] of Object.entries(headers)) {
    merged.set(name, value);
  }

  return new Request(request, { headers: merged }) satisfies Request;
};

const cloudTransport = (headers: Record<string, string>) =>
  ({
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
  }) satisfies V1Transport;

export const sendFile = async (
  headers: Record<string, string>,
  file: { readonly bytes: Uint8Array<ArrayBuffer>; readonly sha: string },
  mime = "image/png",
) => {
  await uploadBlob(cloudTransport(headers), { ...file, mime });
};

export const putTo = async (url: string, bytes: Uint8Array<ArrayBuffer>, mime: string) =>
  await devFilesRoute(
    new Request(new URL(url, ORIGIN), {
      body: bytes,
      headers: { "content-type": mime },
      method: "PUT",
    }),
  );
