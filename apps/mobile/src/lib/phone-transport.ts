// `/v1` as this phone reaches it: the cloud's origin over the global fetch, the build on every
// request, since the Worker meets every install at its build floor, and the device's credential
// as the bearer once a sign-in kept one. The replica's RPC link, its uploads, the file cache's
// downloads and the agent's calls all go through it. No Blob or File crosses it: a file's bytes go
// as the Uint8Array the engine uploads.

import { clientBuildValue, CLIENT_BUILD_HEADER } from "@repo/contract/cloud/client-build";
import type { ClientBuild } from "@repo/contract/cloud/client-build";
import { V1_BLOBS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import type { ReplicaTransport } from "@repo/library-replica/replica-ports";
import { keptFileType } from "@repo/notes/items/item-kind";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { HeldFile } from "../files/file-cache";

export const phoneTransport = (args: {
  readonly origin: string;
  readonly build: ClientBuild;
  readonly credential: string | null;
  readonly fetch: (request: Request) => Promise<Response>;
}): ReplicaTransport => ({
  fetch: async (request) => {
    const headers = new Headers(request.headers);
    headers.set(CLIENT_BUILD_HEADER, clientBuildValue(args.build));
    if (args.credential !== null) {
      headers.set("authorization", `Bearer ${args.credential}`);
    }
    return await args.fetch(new Request(request, { headers }));
  },
  origin: args.origin,
});

// the cell's calls the replica does not make (the agent, the account), over the same transport
export const v1ClientOver = (transport: ReplicaTransport): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => await transport.fetch(new Request(url, init)),
      origin: transport.origin,
      url: V1_RPC_PATH,
    }),
  );

// a file's bytes from `/v1/blobs/<sha>`, checked against the hash it is named by, and the type the
// cloud serves it as, the one it was kept as; null when the cloud holds none
export const downloadBlob = async (
  transport: ReplicaTransport,
  sha256Hex: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>,
  sha: string,
): Promise<HeldFile | null> => {
  const response = await transport.fetch(new Request(`${transport.origin}${V1_BLOBS_PATH}/${sha}`));
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw new Error(`The library's file did not come (${String(response.status)}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== sha) {
    throw new Error("The library's file came changed on the way.");
  }
  return { bytes, mime: keptFileType(response.headers.get("content-type") ?? "") };
};
